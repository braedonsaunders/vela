// What the current audio route takes: bitstream passthrough, PCM channels and rates, and its kind.
// Passthrough comes from Media3's AudioCapabilities, the same answer DefaultAudioSink acts on, so a format
// declared here is one the player actually sends unchanged (Android TV: AudioManager direct profiles;
// older TVs: the HDMI plug intent's EDID encodings).
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

  fun probe(context: Context): AudioRouteFacts {
    val manager = context.getSystemService(AudioManager::class.java)
    val device = manager?.let(::routedDevice)
    val capabilities = AudioCapabilities.getCapabilities(context, movieAttributes, device, emptyList())
    val passthrough = encodings.filter { capabilities.supportsEncoding(it.first) }.map { it.second }.toSet()
    // A device's own channel list (EDID for HDMI) is more exact than Media3's default of 8.
    val channels = device?.channelCounts?.maxOrNull()?.takeIf { it > 0 } ?: capabilities.maxChannelCount
    return AudioRouteFacts(
      route = device?.let { kind(it.type) } ?: "other",
      passthrough = passthrough,
      maxChannels = channels,
      maxSampleRate = device?.sampleRates?.maxOrNull()?.takeIf { it > 0 },
      deviceName = device?.productName?.toString()?.takeIf { it.isNotBlank() },
    )
  }

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
