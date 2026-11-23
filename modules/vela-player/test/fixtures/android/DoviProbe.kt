package app.ether.vela.player

import java.io.File

// The libdovi bridge on a host JVM, against dovi_tool's own test RPUs (args: the assets/tests directory).
fun main(args: Array<String>) {
  val assets = File(args[0])
  check(DoviNative.available) { "libvela_dovi not on java.library.path" }
  /** An asset (a start code, then the escaped RPU payload) as the UNSPEC62 NAL unit a stream carries. */
  fun unit(name: String): ByteArray {
    val bytes = File(assets, name).readBytes()
    check(bytes.copyOfRange(0, 5).contentEquals(byteArrayOf(0, 0, 0, 1, 0x19)))
    return byteArrayOf(0x7c, 0x01) + bytes.copyOfRange(4, bytes.size)
  }
  val fel = unit("fel_orig.bin")
  // Byte-exact with dovi_tool's own expected outputs (src/tests/rpu.rs): MEL to 8.1, and FEL through MEL to 8.1.
  check(DoviNative.convertTo81(unit("mel_orig.bin"))!!.contentEquals(unit("mel_to_81.bin"))) { "MEL to 8.1 differs from dovi_tool" }
  check(DoviNative.convert(DoviNative.convert(fel, 1)!!, 2)!!.contentEquals(unit("fel_to_81.bin"))) { "FEL to 8.1 differs from dovi_tool" }
  check(DoviNative.convert(fel, 0)!!.contentEquals(fel)) // lossless re-encode
  // Mode 2, the one playback uses, gives a valid RPU that converts no further.
  for (name in listOf("fel_orig.bin", "mel_orig.bin")) {
    val p81 = DoviNative.convertTo81(unit(name)) ?: error("$name did not convert")
    check(DoviNative.convert(p81, 0)!!.contentEquals(p81)) { "$name 8.1 does not round-trip" }
    check(DoviNative.convertTo81(p81)!!.contentEquals(p81)) { "$name 8.1 is not stable" }
  }
  check(DoviNative.convertTo81(byteArrayOf(0x7c, 0x01, 0x00)) == null) // a broken RPU is dropped, not thrown
  // In a whole access unit: the enhancement layer goes, the RPU is converted, the base layer is untouched.
  val start = byteArrayOf(0, 0, 0, 1)
  val slice = byteArrayOf(0x02, 0x01, 0xd0.toByte(), 0x11)
  val access = start + slice + start + byteArrayOf(0x7e, 0x01, 0x40, 0x01) + start + fel
  val rewritten = DolbyVision.rewrite(access) { DoviNative.convertTo81(it) }!!
  check(rewritten.contentEquals(start + slice + start + DoviNative.convertTo81(fel)!!))
  println("libdovi bridge converted Profile 7 FEL and MEL RPUs to 8.1")
}
