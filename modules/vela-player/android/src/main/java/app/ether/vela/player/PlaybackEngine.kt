package app.ether.vela.player

import android.content.Context
import android.content.res.Configuration
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import androidx.media3.common.*
import androidx.media3.common.text.CueGroup
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector

/** One engine per full-screen or preview session. No alternate local decoder engine. */
internal interface PlaybackEngine {
  val liveWindowSeconds: Double
  val state: PlayerState
  var onChange: () -> Unit
  var onFailure: (Int, Boolean) -> Unit
  var onSubtitleCues: (CueGroup) -> Unit
  fun load(url: Uri, plan: PlaybackPlan?, position: Double?, loop: Boolean = false)
  fun attach(surface: Surface?)
  fun play(playing: Boolean)
  fun volume(value: Float)
  fun seek(seconds: Double)
  fun select(type: String, id: Long?)
  fun release()
}

internal class Media3Engine(context: Context, private val preview: Boolean, live: Boolean = false) : PlaybackEngine {
  override val state = PlayerState()
  override var onChange: () -> Unit = {}
  override var onFailure: (Int, Boolean) -> Unit = { _, _ -> }
  override var onSubtitleCues: (CueGroup) -> Unit = {}
  private val main = Handler(Looper.getMainLooper())
  private val selector = DefaultTrackSelector(context)
  private val grant = MediaAccessStore.current
  private val buffering = playbackBuffering(preview, live)
  private val player = ExoPlayer.Builder(context,
    DefaultRenderersFactory(context).setEnableDecoderFallback(true)
      .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON))
    // Foreground streaming needs consistent Wi-Fi latency as well as an awake display.
    // Media3 releases both locks on pause, background pause and engine release.
    .setWakeMode(C.WAKE_MODE_NETWORK)
    .setTrackSelector(selector)
    .setMediaSourceFactory(DefaultMediaSourceFactory(ScopedMediaDataSource.Factory(grant)))
    .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(
      buffering.minimumMs, buffering.maximumMs, buffering.startMs, buffering.resumeMs)
      .setPrioritizeTimeOverSizeThresholds(buffering.prioritizeTime)
      .setTargetBufferBytes(if (preview) 8 * 1024 * 1024 else 64 * 1024 * 1024).build())
    .build()
  override val liveWindowSeconds: Double get() = player.duration.takeIf { it > 0 }?.div(1000.0) ?: Double.NaN
  private var plan: PlaybackPlan? = null
  private var timeline = MediaTimeline()
  private var refused = false
  private var loggedLiveWindow = false
  private val choices = mutableMapOf<Long, Pair<Tracks.Group, Int>>()
  private val tick = object : Runnable {
    override fun run() { update(); main.postDelayed(this, 250) }
  }

  init {
    player.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), !preview)
    player.setHandleAudioBecomingNoisy(!preview)
    // Media3's renderer handles Surface frame-rate hints. Never let previews write them.
    player.setVideoChangeFrameRateStrategy(C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_OFF)
    selector.parameters = selector.buildUponParameters()
      .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, preview)
      .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, preview)
      .setTunnelingEnabled(!preview && context.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_TELEVISION)
      .build()
    player.addAnalyticsListener(object : AnalyticsListener {
      override fun onAudioDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderName: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
        if (!preview) Log.i("vela-media3", "audio decoder $decoderName")
      }
      override fun onVideoDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderName: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
        if (!preview) Log.i("vela-media3", "video decoder $decoderName")
      }
    })
    player.addListener(object : Player.Listener {
      override fun onEvents(player: Player, events: Player.Events) { update() }
      override fun onTimelineChanged(timeline: Timeline, reason: Int) {
        if (plan?.live != true || loggedLiveWindow || timeline.isEmpty) return
        val window = timeline.getWindow(player.currentMediaItemIndex, Timeline.Window())
        if (window.durationMs <= 0) return
        loggedLiveWindow = true
        Log.i("vela-media3", "live window ${window.durationMs / 1000.0}s; initial ${player.currentPosition / 1000.0}s; default ${window.defaultPositionMs / 1000.0}s; speed ${player.playbackParameters.speed}")
      }
      override fun onRenderedFirstFrame() { state.hasFrame = true; update() }
      override fun onCues(cueGroup: CueGroup) { onSubtitleCues(cueGroup) }
      override fun onTracksChanged(tracks: Tracks) {
        updateTracks(tracks)
        // ExoPlayer can otherwise play supported audio while silently omitting unsupported video.
        val video = tracks.groups.filter { it.type == C.TRACK_TYPE_VIDEO }
        if (!refused && missingSupportedVideo(tracks.groups.isNotEmpty(), video.isNotEmpty(), video.any { it.isSupported },
            plan?.paths?.any { it.expectsVideo } == true)) {
          refused = true
          onFailure(PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED, false)
        } else update()
      }
      override fun onPlayerError(error: PlaybackException) {
        val refused = generateSequence(error as Throwable?) { it.cause }.filterIsInstance<MediaHttpFailure>().firstOrNull()
        onFailure(refused?.status ?: error.errorCode, refused?.status in listOf(401, 403))
      }
    })
    main.post(tick)
  }

  override fun load(url: Uri, plan: PlaybackPlan?, position: Double?, loop: Boolean) {
    this.plan = plan
    // Live windows have their own clock; never rebase them or move them to the edge.
    timeline = MediaTimeline(if (plan?.live != true && plan?.selectedPath?.transport == "hls") plan?.selectedPath?.timelineOriginSeconds ?: 0.0 else 0.0)
    if (!preview) Log.i("vela-media3", "media timeline origin ${timeline.origin}s")
    state.position = position ?: 0.0
    refused = false
    loggedLiveWindow = false
    val builder = MediaItem.Builder().setUri(url)
    // Disable Media3's automatic live offset correction; explicit seeks still work.
    if (plan?.live == true) builder.setLiveConfiguration(
      MediaItem.LiveConfiguration.Builder()
        .setTargetOffsetMs(18_000)
        .setMinPlaybackSpeed(1f).setMaxPlaybackSpeed(1f).build())

    if (plan?.selectedPath?.transport == "hls") builder.setMimeType(MimeTypes.APPLICATION_M3U8)
    if (plan?.selectedPath?.transport == "dash") builder.setMimeType(MimeTypes.APPLICATION_MPD)
    builder.setSubtitleConfigurations(plan?.subtitleTracks.orEmpty().mapNotNull { track ->
      if (!track.canRenderExternal) return@mapNotNull null
      val uri = track.externalUrl?.let(MediaAccessStore::resolve) ?: return@mapNotNull null
      val mime = when (track.externalFormat?.lowercase()) {
        "srt", "subrip" -> MimeTypes.APPLICATION_SUBRIP
        "ass", "ssa" -> MimeTypes.TEXT_SSA
        else -> MimeTypes.TEXT_VTT
      }
      MediaItem.SubtitleConfiguration.Builder(uri).setId(track.id).setMimeType(mime)
        .setLanguage(track.language).setLabel(track.name).build()
    })
    player.repeatMode = if (loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
    player.setMediaItem(builder.build(), position?.let { (timeline.mediaTime(it) * 1000).toLong() } ?: C.TIME_UNSET)
    player.prepare()
  }

  private fun updateTracks(tracks: Tracks) {
    choices.clear()
    state.audioId = null
    state.subtitleId = null
    val offsets = mutableMapOf<String, Int>()
    state.tracks = tracks.groups.flatMap { group ->
      val type = when (group.type) { C.TRACK_TYPE_AUDIO -> "audio"; C.TRACK_TYPE_TEXT -> "sub"; else -> return@flatMap emptyList() }
      (0 until group.length).map { index ->
        val format = group.getTrackFormat(index)
        val id = (choices.size + 1).toLong()
        choices[id] = group to index
        val external = plan?.subtitleTracks?.firstOrNull { it.matchesExternalFormat(format.id) }
        val ordinal = offsets[type] ?: 0
        if (external == null) offsets[type] = ordinal + 1
        val planned = if (type == "audio") plan?.audioTracks.orEmpty() else plan?.subtitleTracks.orEmpty().filter { !it.isExternal }
        val stream = planned.sortedBy { it.streamIndex ?: Int.MAX_VALUE }.getOrNull(ordinal)?.streamIndex
        if (group.isTrackSelected(index)) {
          if (type == "audio") state.audioId = id else state.subtitleId = id
        }
        mapOf("id" to id, "type" to type, "ff-index" to stream?.toLong(), "external" to (external != null),
          "plan-id" to external?.id, "title" to format.label, "lang" to format.language, "codec" to format.sampleMimeType)
      }
    }
  }

  private fun update() {
    state.loaded = player.playbackState in listOf(Player.STATE_READY, Player.STATE_ENDED) || state.loaded
    state.paused = !player.playWhenReady
    state.pausedForCache = player.playbackState == Player.STATE_BUFFERING
    state.finished = player.playbackState == Player.STATE_ENDED
    state.position = timeline.titleTime(player.currentPosition.coerceAtLeast(0) / 1000.0)
    state.duration = player.duration.takeIf { it != C.TIME_UNSET && it >= 0 }?.div(1000.0)?.let(timeline::titleTime)
    state.cacheAhead = (player.bufferedPosition - player.currentPosition).coerceAtLeast(0) / 1000.0
    player.videoDecoderCounters?.let { counters ->
      counters.ensureUpdated()
      state.droppedFrames = counters.droppedBufferCount.toLong()
      state.totalFrames = counters.renderedOutputBufferCount.toLong() + counters.droppedBufferCount
    }
    player.videoFormat?.let { format ->
      state.videoCodec = format.sampleMimeType
      state.frameRate = format.frameRate.toDouble().takeIf { it > 0 }
      val gamma = when (format.colorInfo?.colorTransfer) { C.COLOR_TRANSFER_ST2084 -> "pq"; C.COLOR_TRANSFER_HLG -> "hlg"; else -> "sdr" }
      state.videoParams = mapOf("w" to format.width.toLong(), "h" to format.height.toLong(), "gamma" to gamma,
        "light" to if (format.sampleMimeType == MimeTypes.VIDEO_DOLBY_VISION) "dolby-vision" else "")
    }
    onChange()
  }

  override fun attach(surface: Surface?) { player.setVideoSurface(surface) }
  override fun play(playing: Boolean) { player.playWhenReady = playing }
  override fun volume(value: Float) { player.volume = value }
  override fun seek(seconds: Double) { player.seekTo((timeline.mediaTime(seconds) * 1000).toLong()) }
  override fun select(type: String, id: Long?) {
    val trackType = if (type == "audio") C.TRACK_TYPE_AUDIO else C.TRACK_TYPE_TEXT
    val params = selector.buildUponParameters().clearOverridesOfType(trackType).setTrackTypeDisabled(trackType, id == null)
    val choice = choices[id]
    if (choice != null) params.addOverride(TrackSelectionOverride(choice.first.mediaTrackGroup, choice.second))
    selector.parameters = params.build()
  }
  override fun release() { main.removeCallbacks(tick); player.release() }
}
