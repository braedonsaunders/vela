// The Expo module: VelaPlayer.setMediaAccess, VelaPlayer.capabilities and the VelaPlayerView view
// (packages/player-api).
package app.ether.vela.player

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VelaPlayerModule : Module() {
  /** The audio player, reporting to this module's JavaScript. */
  private fun audio(): AudioPlayback {
    AudioPlayback.emit = { body -> sendEvent("onAudio", body) }
    return AudioPlayback
  }

  /** The offline downloads engine, reporting to this module's JavaScript (onDownload). */
  private fun downloads(): OfflineDownloads {
    val context = appContext.reactContext ?: throw IllegalStateException("Downloads context unavailable")
    return OfflineDownloads.start(context).also { it.emit = { body -> sendEvent("onDownload", body) } }
  }

  /** Android 13+: ask once, at the first download, to show its progress notification. Downloads go on
   * whatever the answer (without a notification when it is denied). */
  private fun askForDownloadNotifications() {
    if (!OfflineDownloads.shouldAskForNotifications()) return
    val context = appContext.reactContext ?: return
    val permission = "android.permission.POST_NOTIFICATIONS"
    if (context.checkSelfPermission(permission) == android.content.pm.PackageManager.PERMISSION_GRANTED) return
    try { appContext.permissions?.askForPermissions({ }, permission) } catch (_: Exception) { }
  }

  override fun definition() = ModuleDefinition {
    Name("VelaPlayer")

    // Local playback of downloads needs the downloads root's scope even before any downloads call.
    OnCreate {
      appContext.reactContext?.let { OfflineDownloads.start(it) }
    }

    // The trusted playback controller's media access; null clears it.
    Function("setMediaAccess") { access: Map<String, Any?>? ->
      MediaAccessStore.current = access?.let(MediaAccess::from)
    }

    // What this device plays, for the client's negotiation request (probed once per process).
    Function("capabilities") {
      PlayerCapabilities.capabilities(appContext.reactContext)
    }

    // What the device is (memory, low-RAM flag, CPU), for the app's render tier.
    Function("deviceProfile") {
      DeviceProfile.read(appContext.reactContext)
    }

    Function("decoderCapabilities") {
      PlayerCapabilities.decoderDetails()
    }

    // Internal diagnostics for device profiling; no player/chrome API or media data changes.
    Function("setCPUProfiling") { enabled: Boolean ->
      val profiler = Class.forName("com.facebook.hermes.instrumentation.HermesSamplingProfiler")
      if (enabled) {
        profiler.getMethod("enable").invoke(null)
        null
      } else {
        val context = appContext.reactContext ?: throw IllegalStateException("Player context unavailable")
        val file = java.io.File(context.externalCacheDir ?: context.cacheDir, "vela-cpu-profile.json")
        profiler.getMethod("dumpSampledTraceToFile", String::class.java).invoke(null, file.path)
        profiler.getMethod("disable").invoke(null)
        file.path
      }
    }

    // Music, audiobooks and podcasts: one Media3 player for the app in the media session
    // (modules/vela-player/src/audio.ts). Its status and the system's media commands arrive as onAudio.
    // onNetwork: the network became metered or unmetered (NetworkMetering), for the streaming cap.
    // onDownload: offline transfer progress, pauses, completion and failure (OfflineDownloads).
    Events("onAudio", "onNetwork", "onDownload")
    Function("networkMetered") {
      NetworkMetering.changed = { metered -> sendEvent("onNetwork", mapOf("metered" to metered)) }
      NetworkMetering.metered(appContext.reactContext)
    }

    AsyncFunction("audioLoad") { request: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw IllegalStateException("Player context unavailable")
      audio().load(context, (request["id"] as? Number)?.toInt() ?: 0, request["url"] as? String ?: "",
        @Suppress("UNCHECKED_CAST") (request["access"] as? Map<String, Any?>),
        (request["start"] as? Number)?.toDouble() ?: 0.0, (request["rate"] as? Number)?.toDouble() ?: 1.0)
    }.runOnQueue(Queues.MAIN)
    // `gain`: the preloaded item's levelling; `crossfade` { seconds, at }: AutoMix (docs/sound.md).
    AsyncFunction("audioPreload") { request: Map<String, Any?>? ->
      val crossfade = request?.get("crossfade") as? Map<*, *>
      audio().preload((request?.get("id") as? Number)?.toInt(), request?.get("url") as? String,
        @Suppress("UNCHECKED_CAST") (request?.get("access") as? Map<String, Any?>),
        (request?.get("start") as? Number)?.toDouble() ?: 0.0,
        (request?.get("gain") as? Number)?.toDouble() ?: 1.0,
        crossfade?.let { fade ->
          val seconds = (fade["seconds"] as? Number)?.toDouble() ?: return@let null
          val at = (fade["at"] as? Number)?.toDouble() ?: return@let null
          seconds to at
        })
    }.runOnQueue(Queues.MAIN)
    // Levelling (the playing item's gain, linear) and the EQ ({ preGainDb, filters } or null).
    AsyncFunction("audioSound") { sound: Map<String, Any?> ->
      audio().sound((sound["gain"] as? Number)?.toDouble() ?: 1.0, EqChain.from(sound["eq"]))
    }.runOnQueue(Queues.MAIN)
    // Measurement only (debuggable builds): captures the processed output to `<path>-deck<n>.wav/.json`
    // (the device gets silence) until called with null, which returns the files written.
    AsyncFunction("audioCapture") { path: String? ->
      val context = appContext.reactContext ?: throw IllegalStateException("Player context unavailable")
      if ((context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0) {
        throw IllegalStateException("Audio capture is only in debug builds")
      }
      audio().capture(path)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("audioPlay") { audio().play() }.runOnQueue(Queues.MAIN)
    AsyncFunction("audioPause") { audio().pause() }.runOnQueue(Queues.MAIN)
    AsyncFunction("audioSeek") { seconds: Double -> audio().seek(seconds) }.runOnQueue(Queues.MAIN)
    AsyncFunction("audioSetRate") { rate: Double -> audio().setRate(rate) }.runOnQueue(Queues.MAIN)
    AsyncFunction("audioUnload") { audio().unload() }.runOnQueue(Queues.MAIN)
    AsyncFunction("audioNowPlaying") { info: Map<String, Any?>? ->
      val artwork = (info?.get("artwork") as? String)?.takeIf { it.isNotEmpty() }?.let(android.net.Uri::parse)
      audio().setNowPlaying(info?.let { SessionInfo(it["title"] as? String ?: "", it["artist"] as? String ?: "", it["album"] as? String ?: "", artwork) },
        info?.get("spoken") as? Boolean ?: false)
    }.runOnQueue(Queues.MAIN)

    // Offline original-file downloads on Android phones, tablets and TVs (OfflineDownloads, DownloadService).
    Function("downloadsBaseDirectoryUrl") { downloads().baseDirectoryUrl() }
    AsyncFunction("downloadsFreeBytes") { downloads().freeBytes()?.toDouble() }
    AsyncFunction("downloadsReadSnapshot") { downloads().readSnapshot() }
    AsyncFunction("downloadsWriteSnapshot") { snapshot: Map<String, Any?> -> downloads().writeSnapshot(snapshot) }
    AsyncFunction("downloadsStartTransfer") { request: Map<String, Any?> ->
      val parsed = DownloadRequest.from(request)
      askForDownloadNotifications()
      downloads().startTransfer(parsed)
    }
    AsyncFunction("downloadsResumeTransfer") { request: Map<String, Any?> ->
      downloads().resumeTransfer(DownloadRequest.from(request))
    }
    AsyncFunction("downloadsPauseTransfer") { serverId: String, viewerId: String, titleId: String ->
      downloads().pauseTransfer(serverId, viewerId, titleId)
    }
    AsyncFunction("downloadsRemoveTitle") { serverId: String, viewerId: String, titleId: String ->
      downloads().removeTitle(serverId, viewerId, titleId)
    }
    AsyncFunction("downloadsRemoveViewer") { serverId: String, viewerId: String -> downloads().removeViewer(serverId, viewerId) }
    AsyncFunction("downloadsRemoveServer") { serverId: String -> downloads().removeServer(serverId) }

    // The viewer left the app: playing views pause, previews stop with their windows.
    OnActivityEntersBackground {
      VelaPlayerView.live.forEach { it.enterBackground() }
    }

    OnActivityEntersForeground {
      VelaPlayerView.live.forEach { it.enterForeground() }
    }

    // Home while a full-screen video plays: Android before 12 has no auto-enter, so the player opens the window.
    OnUserLeavesActivity {
      PictureInPicture.userLeaving(appContext.currentActivity)
    }

    // Whether the activity shows the player in picture-in-picture now: the app is paused yet still on screen,
    // so its watch session goes on (read as the app leaves the foreground).
    Function("pictureInPicture") {
      PictureInPicture.active(appContext.currentActivity)
    }

    View(VelaPlayerView::class) {
      Events("onSnapshot", "onError", "onObservation", "onCommand", "onSessionCommand", "onSessionRefresh", "onPictureInPicture")

      Prop("ambient") { view: VelaPlayerView, ambient: Boolean? ->
        view.setAmbient(ambient ?: false)
      }
      Prop("tile") { view: VelaPlayerView, tile: Int? ->
        view.setTile(tile)
      }
      Prop("captionInsets") { view: VelaPlayerView, insets: Map<String, Double>? ->
        view.setCaptionInsets(insets)
      }
      Prop("videoFill") { view: VelaPlayerView, fill: Boolean? ->
        view.setVideoFill(fill ?: false)
      }
      Prop("metadata") { view: VelaPlayerView, metadata: Map<String, Any?>? ->
        view.setMetadata(metadata)
      }
      Prop("plan") { view: VelaPlayerView, plan: Map<String, Any?>? ->
        view.setPlan(plan)
      }
      Prop("preview") { view: VelaPlayerView, preview: Map<String, Any?>? ->
        view.setPreview(preview)
      }
      Prop("active") { view: VelaPlayerView, active: Boolean? ->
        view.setActive(active ?: true)
      }
      Prop("command") { view: VelaPlayerView, command: Map<String, Any?>? ->
        view.setCommand(command)
      }
      Prop("serverError") { view: VelaPlayerView, failure: Map<String, Any?>? ->
        view.setServerError(failure)
      }

      OnViewDidUpdateProps { view: VelaPlayerView -> view.applyProps() }

      OnViewDestroys { view: VelaPlayerView ->
        view.release()
      }
    }
  }
}
