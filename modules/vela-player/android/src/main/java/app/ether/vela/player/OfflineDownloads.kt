// Offline downloads on Android phones, tablets and TVs (packages/core DownloadsPort, docs/downloads.md).
// Files live under noBackupFilesDir/vela-downloads/<serverId>/<viewerId>/<titleId>/ (app-specific, never backed
// up). index.json and outbox.json are the core's, written atomically; paths in them stay relative.
//
// One worker thread runs the queue, one transfer at a time and in order (OfflineTransfer). DownloadService keeps
// the process in the foreground with a notification while the queue has work. Requests and their headers are
// held in memory only: after the process dies, readSnapshot reports leftover queued/downloading records as
// paused/interrupted and the core resumes them with fresh headers.
package app.ether.vela.player

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.StatFs
import android.os.storage.StorageManager
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

internal object OfflineDownloads {
  /** What the notification shows. */
  class Status(val title: String?, val bytesWritten: Long, val byteLength: Long?, val waiting: String?, val queued: Int)

  private val lock = Object()
  @Volatile private var context: Context? = null
  private lateinit var root: File
  /** Requests in queue order; the head is running or waiting. In memory only. */
  private val queue = LinkedHashMap<String, DownloadRequest>()
  private var active: OfflineTransfer? = null
  private var activeKey: String? = null
  /** Why the head is not running (no network, waiting for Wi-Fi, retrying), or null. */
  private var waiting: String? = null
  private var bytes: Pair<Long, Long?> = 0L to null
  /** Title names from the index, for the notification. */
  private val names = HashMap<String, String>()
  private var worker: Thread? = null
  /** The head's consecutive transient failures and when it may try again. */
  private var failedKey: String? = null
  private var failures = 0
  private var retryAt = 0L
  private const val RETRYING = "Connection lost. Retrying soon"
  /** About ten minutes of failed attempts (2 s doubling to 60 s) without a byte: the transfer fails. */
  private const val MAX_FAILURES = 14
  @Volatile private var online = true
  @Volatile private var unmetered = true
  private var askedNotifications = false
  /** Hears progress, pauses, completions and failures (the module's onDownload). */
  @Volatile var emit: ((Map<String, Any?>) -> Unit)? = null
  /** The service's notification refresh. */
  @Volatile var changed: (() -> Unit)? = null

  fun start(context: Context): OfflineDownloads {
    synchronized(lock) {
      if (this.context != null) return this
      val app = context.applicationContext
      root = File(app.noBackupFilesDir, "vela-downloads").apply { mkdirs() }.canonicalFile
      LocalMedia.scope = LocalMediaScope(root)
      this.context = app
      watchNetwork(app)
    }
    return this
  }

  // MARK: Directory and snapshot

  fun baseDirectoryUrl(): String = Uri.fromFile(root).toString().trimEnd('/') + "/"

  fun freeBytes(): Long? = try {
    root.mkdirs()
    val storage = context?.getSystemService(StorageManager::class.java)
    if (Build.VERSION.SDK_INT >= 26 && storage != null) storage.getAllocatableBytes(storage.getUuidForPath(root))
    else StatFs(root.path).availableBytes
  } catch (_: Exception) {
    try { StatFs(root.path).availableBytes } catch (_: Exception) { null }
  }

  fun readSnapshot(): Map<String, Any?> {
    val records = (readJson(File(root, "index.json")) as? JSONArray)?.let(::list).orEmpty()
    val outbox = (readJson(File(root, "outbox.json")) as? JSONArray)?.let(::list).orEmpty()
    val live = synchronized(lock) { queue.keys.toSet() }
    val items = records.mapNotNull { it as? Map<*, *> }.map { raw ->
      @Suppress("UNCHECKED_CAST") var record = raw as Map<String, Any?>
      val dir = directory(record)
      // An event stored beside the files (a completion or pause while JavaScript was away) wins.
      val event = dir?.let { readJson(File(it, "transfer-status.json")) as? JSONObject }?.let(::map)
      if (event != null) {
        record = record + event
        if (event["status"] == "completed") record = record - listOf("previousCompleted", "error", "errorCode", "neededBytes")
      }
      val key = dir?.let { "${record["serverId"]}/${record["viewerId"]}/${record["titleId"]}" }
      val status = record["status"]
      if ((status == "queued" || status == "downloading") && key !in live) {
        // The transfer died with the process: the core resumes it with fresh headers.
        val part = dir?.listFiles { file -> file.name.startsWith("media.") && file.name.endsWith(".part") }?.firstOrNull()
        record = record + mapOf("status" to "paused", "errorCode" to "interrupted",
          "error" to "The download stopped when Vela closed", "bytesWritten" to (part?.length() ?: 0L))
      }
      record
    }
    remember(items)
    return mapOf("items" to items, "outbox" to outbox)
  }

  fun readSnapshotJson(): String = json(readSnapshot()).toString()

  /** A JSON object from JavaScript as a map (JSON null as null). */
  fun parse(text: String): Map<String, Any?> = try { map(JSONObject(text)) }
    catch (_: Exception) { throw IllegalArgumentException("Invalid downloads JSON") }

  fun writeSnapshot(snapshot: Map<String, Any?>) {
    val items = snapshot["items"] as? List<*> ?: emptyList<Any?>()
    val outbox = snapshot["outbox"] as? List<*> ?: emptyList<Any?>()
    synchronized(lock) {
      root.mkdirs()
      AtomicFiles.write(File(root, "index.json"), json(items).toString().toByteArray())
      AtomicFiles.write(File(root, "outbox.json"), json(outbox).toString().toByteArray())
    }
    remember(items)
  }

  private fun remember(items: List<*>) {
    synchronized(lock) {
      for (item in items) {
        val record = item as? Map<*, *> ?: continue
        val name = (record["title"] as? Map<*, *>)?.get("name") as? String ?: continue
        names["${record["serverId"]}/${record["viewerId"]}/${record["titleId"]}"] = name
      }
    }
  }

  // MARK: Transfer control

  /** A new download: any partial file of this title is discarded. */
  fun startTransfer(request: DownloadRequest) {
    stop(request.key, removeQueued = true)
    directory(request.serverId, request.viewerId, request.titleId)?.let { dir ->
      dir.listFiles { file -> file.name.startsWith("media.") && (file.name.endsWith(".part") || file.name.endsWith(".part.json")) }
        ?.forEach { it.delete() }
      File(dir, "transfer-status.json").delete()
    }
    enqueue(request)
  }

  /** Resume with fresh headers, keeping the partial file. Idempotent for a transfer already queued or running
   * (the core and the network callback may both resume it): the fresh request (URL, headers, Wi-Fi rule) is
   * swapped in for the next attempt, and the running connection is neither restarted nor doubled. */
  fun resumeTransfer(request: DownloadRequest) {
    synchronized(lock) {
      val current = queue[request.key]
      if (current != null && current.sameFile(request)) {
        queue[request.key] = request
        // Fresh credentials try again now, without waiting out a backoff.
        retryAt = 0
        if (activeKey == request.key && networkBlocks(request) != null) active?.cancel()
        wakeLocked()
        return
      }
    }
    stop(request.key, removeQueued = true)
    directory(request.serverId, request.viewerId, request.titleId)?.let { File(it, "transfer-status.json").delete() }
    enqueue(request)
  }

  fun pauseTransfer(serverId: String, viewerId: String, titleId: String) {
    val key = "$serverId/$viewerId/$titleId"
    val written = stop(key, removeQueued = true) ?: return
    report(key, mapOf("status" to "paused", "bytesWritten" to written.first, "byteLength" to written.second))
  }

  /** The notification's Pause: every queued and running download, as if the viewer paused each. */
  fun pauseAll() {
    val keys = synchronized(lock) { queue.keys.toList() }
    keys.forEach { key -> key.split('/').let { pauseTransfer(it[0], it[1], it[2]) } }
  }

  fun removeTitle(serverId: String, viewerId: String, titleId: String) = remove(listOf(serverId, viewerId, titleId))
  fun removeViewer(serverId: String, viewerId: String) = remove(listOf(serverId, viewerId))
  fun removeServer(serverId: String) = remove(listOf(serverId))

  private fun remove(components: List<String>) {
    val prefix = components.joinToString("/") + "/"
    val keys = synchronized(lock) { queue.keys.filter { "$it/".startsWith(prefix) } }
    keys.forEach { stop(it, removeQueued = true) }
    val dir = directory(*components.toTypedArray()) ?: return
    dir.deleteRecursively()
  }

  /** The service stopped for good (Android's data-sync time limit): every transfer is interrupted. */
  fun interruptAll(message: String) {
    val keys = synchronized(lock) { queue.keys.toList() }
    for (key in keys) {
      val written = stop(key, removeQueued = true) ?: continue
      report(key, mapOf("status" to "paused", "errorCode" to "interrupted", "error" to message,
        "bytesWritten" to written.first, "byteLength" to written.second))
    }
  }

  fun status(): Status? = synchronized(lock) {
    val key = queue.keys.firstOrNull() ?: return null
    Status(names[key], bytes.first, bytes.second ?: queue[key]?.byteLength, waiting, queue.size - 1)
  }

  fun hasWork(): Boolean = synchronized(lock) { queue.isNotEmpty() }

  /** Ask once per process, at the first download, to show the progress notification (Android 13+). Denied:
   * downloads go on without it. */
  fun shouldAskForNotifications(): Boolean = synchronized(lock) {
    if (askedNotifications || Build.VERSION.SDK_INT < 33) return false
    askedNotifications = true
    true
  }

  private fun enqueue(request: DownloadRequest) {
    synchronized(lock) {
      queue[request.key] = request
      if (worker == null) {
        worker = Thread(::work, "vela-downloads").apply { isDaemon = true; start() }
      }
      wakeLocked()
    }
    context?.let { DownloadService.ensure(it) }
    changed?.invoke()
  }

  /** Stops `key`'s running attempt (waiting for it to let go of its files) and drops it from the queue.
   * Returns its bytes written so far, or null when it was not queued. */
  private fun stop(key: String, removeQueued: Boolean): Pair<Long, Long?>? {
    val written = synchronized(lock) {
      val request = (if (removeQueued) queue.remove(key) else queue[key]) ?: return null
      if (activeKey == key) {
        active?.cancel()
        val deadline = System.currentTimeMillis() + 3_000
        while (activeKey == key && System.currentTimeMillis() < deadline) lock.wait(100)
      }
      wakeLocked()
      val part = directory(request.serverId, request.viewerId, request.titleId)?.let { File(it, "media.${request.container}.part") }
      (part?.length() ?: 0L) to request.byteLength
    }
    changed?.invoke()
    return written
  }

  private fun wakeLocked() = lock.notifyAll()

  /** Whether the network allows `request` now; otherwise the reason it waits. */
  private fun networkBlocks(request: DownloadRequest): String? = when {
    !online -> "Waiting for a network connection"
    request.wifiOnly && !unmetered -> "Waiting for Wi-Fi"
    else -> null
  }

  private fun work() {
    while (true) {
      val request: DownloadRequest
      val transfer: OfflineTransfer
      synchronized(lock) {
        while (true) {
          val head = queue.values.firstOrNull()
          if (head == null) {
            waiting = null
            bytes = 0L to null
            changed?.invoke()
            lock.wait()
            continue
          }
          val blocked = networkBlocks(head)
          if (blocked != null) {
            if (waiting != blocked) {
              // Lost network (or no Wi-Fi for a Wi-Fi-only download): paused until it returns, then resumed here.
              waiting = blocked
              val written = directory(head.serverId, head.viewerId, head.titleId)
                ?.let { File(it, "media.${head.container}.part").length() } ?: 0L
              report(head.key, mapOf("status" to "paused", "errorCode" to "interrupted", "error" to blocked,
                "bytesWritten" to written, "byteLength" to head.byteLength), persist = false)
              changed?.invoke()
            }
            lock.wait()
            continue
          }
          if (failedKey != head.key) {
            failedKey = head.key
            failures = 0
            retryAt = 0
          }
          val now = System.currentTimeMillis()
          if (retryAt > now) {
            // Back off after a transient failure; a network change or a resume wakes it early.
            if (waiting != RETRYING) {
              waiting = RETRYING
              changed?.invoke()
            }
            lock.wait(retryAt - now)
            continue
          }
          val dir = directory(head.serverId, head.viewerId, head.titleId)
          if (dir == null) {
            queue.remove(head.key)
            continue
          }
          request = head
          waiting = null
          transfer = OfflineTransfer(request, dir) { written, length ->
            synchronized(lock) { bytes = written to length }
            report(request.key, mapOf("status" to "downloading", "bytesWritten" to written, "byteLength" to length), persist = false)
            changed?.invoke()
          }
          active = transfer
          activeKey = request.key
          bytes = transfer.partBytes() to request.byteLength
          break
        }
      }
      changed?.invoke()
      val outcome = try { transfer.run() } catch (error: Exception) {
        Log.w("vela-downloads", "transfer failed: ${error.javaClass.simpleName}")
        TransferOutcome.Failed("unknown", "The download failed", transfer.partBytes())
      }
      synchronized(lock) {
        active = null
        activeKey = null
        lock.notifyAll()
        // Paused or removed meanwhile: nothing more to report.
        if (queue[request.key] == null) return@synchronized
        when (outcome) {
          is TransferOutcome.Completed -> {
            queue.remove(request.key)
            report(request.key, buildMap {
              put("status", "completed")
              put("bytesWritten", outcome.bytes)
              put("byteLength", outcome.bytes)
              put("mediaPath", outcome.mediaPath)
              outcome.etag?.let { put("etag", it) }
              outcome.lastModified?.let { put("lastModified", it) }
              outcome.posterPath?.let { put("posterPath", it) }
              if (outcome.sidecarPaths.isNotEmpty()) put("sidecarPaths", outcome.sidecarPaths)
            })
          }
          is TransferOutcome.Failed -> {
            Log.i("vela-downloads", "transfer failed: ${outcome.code}")
            queue.remove(request.key)
            report(request.key, buildMap {
              put("status", "failed")
              put("bytesWritten", outcome.bytesWritten)
              put("byteLength", request.byteLength)
              put("error", outcome.message)
              put("errorCode", outcome.code)
              outcome.neededBytes?.let { put("neededBytes", it) }
            })
            // Out of space: the core pauses the rest of the queue, so nothing else starts here either.
            if (outcome.code == "no_space") queue.clear()
          }
          is TransferOutcome.Retry -> {
            failures = if (outcome.progressed) 1 else failures + 1
            // Status and exception class only: never a URL or a header.
            Log.i("vela-downloads", "attempt ended (${outcome.reason}); failures $failures")
            if (failures > MAX_FAILURES) {
              queue.remove(request.key)
              report(request.key, mapOf("status" to "failed", "bytesWritten" to outcome.bytesWritten, "byteLength" to request.byteLength,
                "error" to "The download was interrupted before it finished", "errorCode" to "network"))
            } else {
              retryAt = System.currentTimeMillis() + DownloadRules.backoffMs(failures - 1)
            }
          }
          is TransferOutcome.Cancelled -> Unit
        }
      }
      changed?.invoke()
    }
  }

  // MARK: Network

  private fun watchNetwork(context: Context) {
    val connectivity = context.getSystemService(ConnectivityManager::class.java) ?: return
    fun apply(capabilities: NetworkCapabilities?) {
      val nowOnline = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
      val nowUnmetered = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true
      synchronized(lock) {
        if (nowOnline == online && nowUnmetered == unmetered) return
        online = nowOnline
        unmetered = nowUnmetered
        // A running transfer the new network does not allow stops now; it waits at the head of the queue.
        val head = activeKey?.let { queue[it] }
        if (head != null && networkBlocks(head) != null) active?.cancel()
        // A network that returns retries at once.
        if (nowOnline) retryAt = 0
        wakeLocked()
      }
      changed?.invoke()
    }
    try {
      apply(connectivity.getNetworkCapabilities(connectivity.activeNetwork))
      connectivity.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = apply(capabilities)
        override fun onLost(network: Network) = apply(null)
      })
    } catch (_: Exception) {
      // Without the network-state permission downloads run as if always online; failures back off.
    }
  }

  // MARK: Events

  private fun report(key: String, fields: Map<String, Any?>, persist: Boolean = true) {
    val parts = key.split('/')
    val payload = mapOf("serverId" to parts[0], "viewerId" to parts[1], "titleId" to parts[2]) + fields.filterValues { it != null }
    // An event can arrive before JavaScript listens (or after it has gone): keep the last one beside the files,
    // so an older index written by JavaScript cannot hide a finished download or a pause.
    if (persist) directory(parts[0], parts[1], parts[2])?.let { dir ->
      try { AtomicFiles.write(File(dir, "transfer-status.json"), json(payload).toString().toByteArray()) } catch (_: Exception) { }
    }
    try { emit?.invoke(payload) } catch (_: Exception) { }
  }

  // MARK: Paths and JSON

  private fun directory(record: Map<String, Any?>): File? {
    val server = record["serverId"] as? String ?: return null
    val viewer = record["viewerId"] as? String ?: return null
    val title = record["titleId"] as? String ?: return null
    return directory(server, viewer, title)
  }

  /** A directory under the root from validated components, or null. */
  private fun directory(vararg components: String): File? {
    if (components.isEmpty() || !components.all(DownloadRules::safeComponent)) return null
    val dir = components.fold(root) { parent, name -> File(parent, name) }
    val prefix = root.path + File.separator
    return dir.takeIf { it.path.startsWith(prefix) }
  }

  private fun readJson(file: File): Any? = try {
    val text = file.readText().trim()
    if (text.startsWith("[")) JSONArray(text) else JSONObject(text)
  } catch (_: Exception) { null }

  private fun json(value: Any?): Any? = when (value) {
    null -> JSONObject.NULL
    is Map<*, *> -> JSONObject().apply { value.forEach { (k, v) -> if (k is String) put(k, json(v)) } }
    is List<*> -> JSONArray().apply { value.forEach { put(json(it)) } }
    is Array<*> -> JSONArray().apply { value.forEach { put(json(it)) } }
    // Whole numbers stay integers (byte counts), not 1.2E9.
    is Double -> if (value.isFinite() && value == Math.floor(value) && Math.abs(value) < 9.0E15) value.toLong() else value
    is Float -> json(value.toDouble())
    is Number, is Boolean, is String -> value
    else -> value.toString()
  }

  private fun map(json: JSONObject): Map<String, Any?> =
    json.keys().asSequence().associateWith { value(json.opt(it)) }

  private fun list(json: JSONArray): List<Any?> = (0 until json.length()).map { value(json.opt(it)) }

  private fun value(item: Any?): Any? = when (item) {
    JSONObject.NULL, null -> null
    is JSONObject -> map(item)
    is JSONArray -> list(item)
    else -> item
  }
}
