// The foreground service (type dataSync) that keeps offline downloads going while Vela is in the background
// (OfflineDownloads). Its notification shows the running title's progress, a Pause action (every queued
// download) and opens the Downloads library (vela://downloads) when tapped. It stops itself when the queue
// is empty. Nothing in its intents carries a URL or a header.
package app.ether.vela.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log

class DownloadService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private var refreshQueued = false
  private var lastPost = 0L
  private var foreground = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    running = this
    OfflineDownloads.start(this)
    OfflineDownloads.changed = { running?.scheduleRefresh() }
    channel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_PAUSE) {
      // Pausing waits for the running transfer to let go of its file: off the main thread.
      // The emptied queue then stops the service (refresh).
      Thread({ OfflineDownloads.pauseAll(); scheduleRefresh() }, "vela-downloads-pause").start()
      return START_NOT_STICKY
    }
    // Started with startForegroundService: always enter the foreground, then leave at once if idle.
    promote()
    if (!OfflineDownloads.hasWork()) finish()
    // Never restarted by the system: its requests (and their headers) died with the process.
    return START_NOT_STICKY
  }

  /** Android 14+ ends a data-sync service after its daily allowance: transfers are interrupted and resume on
   * the next launch with fresh headers. */
  override fun onTimeout(startId: Int) = timedOut()
  override fun onTimeout(startId: Int, fgsType: Int) = timedOut()

  private fun timedOut() {
    Thread({ OfflineDownloads.interruptAll("Android paused downloads in the background. They resume when you open Vela.") },
      "vela-downloads-timeout").start()
    finish()
  }

  override fun onDestroy() {
    if (running === this) running = null
    main.removeCallbacksAndMessages(null)
    super.onDestroy()
  }

  private fun promote() {
    val notification = notification(OfflineDownloads.status())
    try {
      if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      else startForeground(NOTIFICATION_ID, notification)
      foreground = true
    } catch (error: Exception) {
      // Not allowed to enter the foreground now (started from the background): transfers still run while the
      // process lives.
      Log.w("vela-downloads", "foreground refused: ${error.javaClass.simpleName}")
    }
  }

  private fun finish() {
    if (running === this) running = null
    if (foreground) {
      if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
      foreground = false
    }
    getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
    stopSelf()
  }

  private fun scheduleRefresh() {
    main.post {
      if (refreshQueued) return@post
      refreshQueued = true
      val wait = (lastPost + 1_000 - SystemClock.elapsedRealtime()).coerceAtLeast(0)
      main.postDelayed({
        refreshQueued = false
        lastPost = SystemClock.elapsedRealtime()
        refresh()
      }, wait)
    }
  }

  private fun refresh() {
    if (running !== this) return
    val status = OfflineDownloads.status()
    if (status == null) {
      finish()
      return
    }
    getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification(status))
  }

  private fun channel() {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL) != null) return
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Progress of titles downloading for offline viewing"
      setShowBadge(false)
      setSound(null, null)
    })
  }

  private fun notification(status: OfflineDownloads.Status?): Notification {
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL)
      else @Suppress("DEPRECATION") Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("vela://downloads")).setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val pause = Intent(this, DownloadService::class.java).setAction(ACTION_PAUSE)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val total = status?.byteLength?.takeIf { it > 0 }
    val detail = status?.waiting ?: if (status == null) "Preparing" else if (total != null)
      "${bytes(status.bytesWritten)} of ${bytes(total)}" else bytes(status.bytesWritten)
    val more = status?.queued?.takeIf { it > 0 }?.let { " · $it more queued" }.orEmpty()
    builder
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(status?.title ?: "Downloading")
      .setContentText(detail + more)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(Notification.CATEGORY_PROGRESS)
      .setContentIntent(PendingIntent.getActivity(this, 0, open, flags))
      .addAction(Notification.Action.Builder(null, "Pause", PendingIntent.getService(this, 1, pause, flags)).build())
    if (total != null && status.waiting == null) builder.setProgress(1000, (status.bytesWritten * 1000 / total).toInt().coerceIn(0, 1000), false)
    else builder.setProgress(0, 0, status?.waiting == null)
    if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    return builder.build()
  }

  companion object {
    private const val CHANNEL = "vela-downloads"
    private const val NOTIFICATION_ID = 0x56444c
    private const val ACTION_PAUSE = "app.ether.vela.downloads.PAUSE"
    @Volatile private var running: DownloadService? = null

    /** Start the service (or refresh it) while the queue has work. */
    fun ensure(context: Context) {
      running?.let { it.scheduleRefresh(); return }
      try {
        val intent = Intent(context, DownloadService::class.java)
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      } catch (error: Exception) {
        // Android 12+ refuses a foreground start from the background: the transfer runs while the process lives.
        Log.w("vela-downloads", "service not started: ${error.javaClass.simpleName}")
      }
    }

    private fun bytes(value: Long): String = when {
      value >= 1_000_000_000 -> String.format(java.util.Locale.US, "%.1f GB", value / 1e9)
      value >= 1_000_000 -> String.format(java.util.Locale.US, "%.0f MB", value / 1e6)
      else -> String.format(java.util.Locale.US, "%.0f KB", value / 1e3)
    }
  }
}
