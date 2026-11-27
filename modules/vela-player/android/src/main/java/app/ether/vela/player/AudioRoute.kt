// What the current audio route takes: bitstream passthrough, PCM channels and rates, and its kind.
// Passthrough comes from Media3's AudioCapabilities, the same answer DefaultAudioSink acts on, so a format
// declared here is one the player actually sends unchanged (Android TV: AudioManager direct profiles;
// older TVs: the HDMI plug intent's EDID encodings).
//
// An HDMI source box (a CEC playback device) that reports its HDMI output as the built-in speaker, with a
// static direct profile, says nothing about the TV behind it: Media3 then reads AC-3 and DTS as supported
// whatever the sink takes. On the lab's Allwinner H313 such a track never started (the direct thread paused
// on underrun forever, so the picture held at 0:00). Such a route is an unknown sink: every track is decoded
// to stereo, and the server is told so. A television's own speakers (its Dolby decoder) are unaffected.
package app.ether.vela.player

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.exoplayer.audio.AudioCapabilities

internal data class AudioRouteFacts(
  val route: String,
  val passthrough: Set<String>,
  val maxChannels: Int,
  val maxSampleRate: Int?,
  val deviceName: String?,
)

internal object AudioRoute {
  val movieAttributes: AudioAttributes =
    AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build()

  private val encodings = listOf(
    C.ENCODING_AC3 to "ac3",
    C.ENCODING_E_AC3 to "eac3",
    C.ENCODING_E_AC3_JOC to "eac3-joc",
    C.ENCODING_DOLBY_TRUEHD to "truehd",
    C.ENCODING_DTS to "dts",
    C.ENCODING_DTS_HD to "dts-hd",
    C.ENCODING_DTS_UHD_P2 to "dts-uhd",
  )

  /** Set when a bitstream track never started on this device (BitstreamStall): later loads decode every
   * track, and the server is no longer offered passthrough. Kept per device (vela.player preferences) until
   * the route changes kind. */
  @Volatile var bitstreamStalled = false
    private set
  private var stallsLoaded = false

  /** Records that the current route's bitstream never started (and loads that record once). */
  fun loadBitstreamStall(context: Context) {
    if (stallsLoaded) return
    stallsLoaded = true
    val stored = context.getSharedPreferences("vela.player", Context.MODE_PRIVATE).getString("bitstream.stalled", null)
    bitstreamStalled = stored != null && stored == currentKind(context)
  }

  fun markBitstreamStalled(context: Context) {
    bitstreamStalled = true
    stallsLoaded = true
    context.getSharedPreferences("vela.player", Context.MODE_PRIVATE).edit().putString("bitstream.stalled", currentKind(context)).apply()
  }

  private fun currentKind(context: Context): String? =
    runCatching { context.getSystemService(AudioManager::class.java)?.let(::routedDevice)?.let { kind(it.type) } }.getOrNull()

  /** This device is an HDMI source (CEC playback device, `ro.hdmi.device_type` 4) and not a television. */
  private val hdmiSource: Boolean by lazy { PcmLimit.hdmiSource(systemProperty("ro.hdmi.device_type")) }

  fun probe(context: Context): AudioRouteFacts {
    loadBitstreamStall(context)
    val manager = context.getSystemService(AudioManager::class.java)
    val device = manager?.let(::routedDevice)
    val kind = device?.let { kind(it.type) } ?: "other"
    val capabilities = AudioCapabilities.getCapabilities(context, movieAttributes, device, emptyList())
    val unknownSink = unknownSink(kind)
    val passthrough = if (unknownSink || bitstreamStalled) emptySet()
      else encodings.filter { capabilities.supportsEncoding(it.first) }.map { it.second }.toSet()
    // A device's own channel list (EDID for HDMI) is more exact than Media3's default of 8.
    val channels = if (unknownSink) 2 else device?.channelCounts?.maxOrNull()?.takeIf { it > 0 } ?: capabilities.maxChannelCount
    return AudioRouteFacts(
      route = kind,
      passthrough = passthrough,
      maxChannels = channels,
      maxSampleRate = device?.sampleRates?.maxOrNull()?.takeIf { it > 0 },
      deviceName = device?.productName?.toString()?.takeIf { it.isNotBlank() },
    )
  }

  /** An HDMI source's output reported as its speaker: nothing is known about the sink behind it. */
  private fun unknownSink(kind: String) = kind == "speaker" && hdmiSource

  /** Whether the sink may send encoded audio undecoded on the current route (VelaRenderersFactory). */
  fun takesBitstream(context: Context): Boolean = !bitstreamStalled &&
    runCatching { context.getSystemService(AudioManager::class.java)?.let(::routedDevice)?.let { !unknownSink(kind(it.type)) } }.getOrNull() != false

  /** How decoded PCM must be shaped on this device and route, or null to leave it to the system (PcmLimit). */
  fun pcmLimit(context: Context): PcmLimit? {
    val lowRam = runCatching { context.getSystemService(android.app.ActivityManager::class.java)?.isLowRamDevice }.getOrNull() == true
    val unknown = runCatching { context.getSystemService(AudioManager::class.java)?.let(::routedDevice)?.let { unknownSink(kind(it.type)) } }.getOrNull() == true
    return PcmLimit.of(lowRam = lowRam, unknownSink = unknown)
  }

  /** A system property, read as Media3's Util does (reflection on android.os.SystemProperties). */
  private fun systemProperty(name: String): String? = runCatching {
    Class.forName("android.os.SystemProperties").getMethod("get", String::class.java).invoke(null, name) as String
  }.getOrNull()?.takeIf { it.isNotEmpty() }

  /** The output encoding's capability token for a passthrough AudioTrack, or null for PCM. */
  fun passthroughToken(encoding: Int): String? = encodings.firstOrNull { it.first == encoding }?.second

  private fun routedDevice(manager: AudioManager): AudioDeviceInfo? {
    if (Build.VERSION.SDK_INT >= 33) {
      manager.getAudioDevicesForAttributes(movieAttributes.audioAttributesV21.audioAttributes).firstOrNull()?.let { return it }
    }
    // Before Android 13 there is no routing query: take the output media would prefer.
    val outputs = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    return outputs.minByOrNull { priority(it.type) }
  }

  private fun priority(type: Int): Int = when (kind(type)) {
    "hdmi-earc", "hdmi-arc", "hdmi" -> 0
    "usb" -> 1
    "bluetooth" -> 2
    "headphones" -> 3
    "spdif" -> 4
    "speaker" -> 5
    else -> 6
  }

  fun kind(type: Int): String = when (type) {
    AudioDeviceInfo.TYPE_HDMI -> "hdmi"
    AudioDeviceInfo.TYPE_HDMI_ARC -> "hdmi-arc"
    AudioDeviceInfo.TYPE_HDMI_EARC -> "hdmi-earc"
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_BLE_SPEAKER, AudioDeviceInfo.TYPE_BLE_BROADCAST, AudioDeviceInfo.TYPE_HEARING_AID -> "bluetooth"
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE -> "speaker"
    AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "headphones"
    AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_ACCESSORY, AudioDeviceInfo.TYPE_USB_HEADSET -> "usb"
    AudioDeviceInfo.TYPE_LINE_DIGITAL -> "spdif"
    else -> "other"
  }
}
