package app.ether.vela.player

import android.net.Uri
import android.os.Handler
import android.os.SystemClock
import androidx.media3.common.C
import androidx.media3.common.text.Cue
import androidx.media3.common.text.CueGroup
import androidx.media3.datasource.DataSpec
import androidx.media3.extractor.text.CuesWithTiming
import androidx.media3.extractor.text.SubtitleParser
import androidx.media3.extractor.text.webvtt.WebvttParser
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.Future

/** One selected Ether track. Only a response from the current selection and seek can change its cues. */
internal class WindowedSubtitles(
  private val main: Handler,
  private val grant: MediaAccess?,
  private val mediaMicros: () -> Long,
  private val output: (CueGroup) -> Unit,
) {
  private val worker = Executors.newSingleThreadExecutor()
  private var url: Uri? = null
  private var clock = SubtitleWindowClock(0)
  private var task: Future<*>? = null
  private var generation = 0
  private var base: Long? = null
  private var nextPoll = 0L
  private var complete = false
  private var windows = emptyList<CuesWithTiming>()
  private var shown = emptyList<Cue>()
  private val tick = object : Runnable {
    override fun run() {
      val target = url ?: return
      val media = mediaMicros()
      val active = windows.firstOrNull { media >= it.startTimeUs && media < it.endTimeUs }?.cues.orEmpty()
      if (active != shown) {
        shown = active
        output(CueGroup(active, media))
      }
      if (!complete && task == null && SystemClock.elapsedRealtime() >= nextPoll) {
        val from = clock.fromMillis(media, base)
        fetch(target, from)
      }
      main.postDelayed(this, 50)
    }
  }

  fun select(target: Uri?, originSeconds: Double) {
    if (url == target) return
    url = target
    clock = SubtitleWindowClock((originSeconds * 1_000_000).toLong())
    reset()
  }

  fun seek() {
    if (url != null) reset()
  }

  private fun reset() {
    generation++
    task?.cancel(true)
    task = null
    base = null
    nextPoll = 0
    complete = false
    windows = emptyList()
    shown = emptyList()
    output(CueGroup.EMPTY_TIME_ZERO)
    main.removeCallbacks(tick)
    if (url != null) main.post(tick)
  }

  private fun fetch(target: Uri, from: Long) {
    val requestClock = clock
    val epoch = generation
    task = worker.submit {
      val response = runCatching {
        val request = target.buildUpon().clearQuery()
        // Preserve the encoded grant and all query parameters except the previous window cursor.
        val query = target.encodedQuery.orEmpty().split('&').filter {
          it.isNotEmpty() && Uri.decode(it.substringBefore('=')) != "from_ms"
        }
        val uri = request.encodedQuery((query + "from_ms=$from").joinToString("&")).build()
        val source = ScopedMediaDataSource(grant)
        try {
          source.open(DataSpec.Builder().setUri(uri).build())
          val end = source.responseHeaders.entries.any { (name, value) ->
            name.equals("X-Ether-Subtitle-Complete", true) && value.firstOrNull() == "1"
          }
          val body = ByteArrayOutputStream()
          val buffer = ByteArray(8192)
          while (!Thread.currentThread().isInterrupted) {
            val count = source.read(buffer, 0, buffer.size)
            if (count == C.RESULT_END_OF_INPUT) break
            if (body.size() + count > 8 * 1024 * 1024) throw IOException("Subtitle window exceeds bound")
            body.write(buffer, 0, count)
          }
          val cues = ArrayList<CuesWithTiming>()
          WebvttParser().parse(body.toByteArray(), SubtitleParser.OutputOptions.allCues()) {
            cues += CuesWithTiming(it.cues, requestClock.mediaMicros(it.startTimeUs), it.durationUs)
          }
          cues to end
        } finally {
          source.close()
        }
      }
      main.post {
        if (epoch != generation) return@post
        task = null
        nextPoll = SystemClock.elapsedRealtime() + 1000
        response.getOrNull()?.let { (cues, end) ->
          windows = cues
          base = from
          complete = end
        }
      }
    }
  }

  fun release() {
    select(null, 0.0)
    worker.shutdownNow()
  }
}
