// The Android Emulator. Its MediaCodec decoders (goldfish) run inside the emulator's own host process,
// and decoding through them from mpv crashes that process (it segfaults during H.264 and HEVC trailers),
// so on the emulator mpv decodes in software. Real devices always use MediaCodec.
package app.ether.vela.player

import android.os.Build

internal object Emulator {
  val running: Boolean = Build.HARDWARE == "ranchu" || Build.HARDWARE == "goldfish"
}
