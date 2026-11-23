package app.ether.vela.player

// Display matching, format naming, capability tokens and subtitle appearance, on a plain JVM.
fun main() {
  // 23.976 is not 24: a 24 Hz mode drops a frame every 42 seconds.
  check(DisplayModes.cadence(24.0, 23.976) == null)
  check(DisplayModes.cadence(23.976025f.toDouble(), 23.976) == 1)
  check(DisplayModes.cadence(23.976, 23.98) == 1) // a container's rounded rate
  check(DisplayModes.cadence(59.94, 29.97) == 2)
  check(DisplayModes.cadence(60.0, 29.97) == null)
  check(DisplayModes.cadence(119.88, 23.976) == 5)
  check(DisplayModes.cadence(50.0, 25.0) == 2)
  check(DisplayModes.cadence(60.0, 25.0) == null)
  check(DisplayModes.cadence(60.0, 0.0) == null)
  check(DisplayModes.exactRate(23.976) == 24000.0 / 1001)
  check(DisplayModes.exactRate(12.5) == 12.5)

  val uhd60 = DisplayModeFacts(1, 3840, 2160, 60.0)
  val uhd5994 = DisplayModeFacts(2, 3840, 2160, 59.94006)
  val uhd24 = DisplayModeFacts(3, 3840, 2160, 24.0)
  val uhd23 = DisplayModeFacts(4, 3840, 2160, 23.976025)
  val uhd50 = DisplayModeFacts(5, 3840, 2160, 50.0)
  val hd23 = DisplayModeFacts(6, 1920, 1080, 23.976025)
  val uhd4795 = DisplayModeFacts(7, 3840, 2160, 47.952)
  val modes = listOf(uhd60, uhd5994, uhd24, uhd23, uhd50, hd23, uhd4795)
  check(DisplayModes.pick(modes, uhd60, 23.976) == uhd23) // fewest repeats, same resolution
  check(DisplayModes.pick(modes, uhd60, 24.0) == uhd24)
  check(DisplayModes.pick(modes, uhd60, 25.0) == uhd50)
  check(DisplayModes.pick(modes, uhd60, 29.97) == uhd5994)
  check(DisplayModes.pick(modes, uhd5994, 29.97) == uhd5994) // already even: no blanking switch
  check(DisplayModes.pick(modes, uhd60, 30.0) == uhd60)
  check(DisplayModes.pick(listOf(uhd60, hd23), uhd60, 23.976) == null) // never changes resolution
  check(DisplayModes.matchState(modes, uhd23, 23.976, MatchPreference.ALWAYS) == "matched")
  check(DisplayModes.matchState(modes, uhd60, 23.976, MatchPreference.NEVER) == "off")
  check(DisplayModes.matchState(listOf(uhd60), uhd60, 23.976, MatchPreference.ALWAYS) == "unsupported")
  check(DisplayModes.matchState(modes, uhd60, 23.976, MatchPreference.SEAMLESS_ONLY) == "unmatched")

  check(AvFormats.videoCodec("video/dolby-vision", "dvhe.07.06") == "hevc")
  check(AvFormats.videoCodec("video/dolby-vision", "dav1.10.06") == "av1")
  check(AvFormats.videoCodec("video/wvc1") == "vc1")
  check(AvFormats.videoCodec("video/mpeg2") == "mpeg2video")
  check(AvFormats.audioCodec("audio/eac3-joc") == "eac3")
  check(AvFormats.audioCodec("audio/vnd.dts.hd") == "dts")
  check(AvFormats.audioCodec("audio/true-hd") == "truehd")
  check(AvFormats.audioProfile("audio/true-hd", atmos = true) == "Dolby TrueHD + Atmos")
  check(AvFormats.immersive("audio/eac3-joc", false) == "atmos")
  check(AvFormats.immersive("audio/true-hd", false) == null)
  check(AvFormats.layout(8) == "7.1" && AvFormats.layout(12) == "7.1.4" && AvFormats.layout(9) == null)
  check(AvFormats.dolbyVision("dvhe.07.06", "pq") == ("7" to 6))
  check(AvFormats.dolbyVision("dvhe.08.06", "pq") == ("8.1" to 6))
  check(AvFormats.dolbyVision("dvh1.08.09", "hlg") == ("8.4" to 9))
  check(AvFormats.dolbyVision("dvhe.05.06", null) == ("5" to 6))
  check(AvFormats.dolbyVision("hvc1.2.4.L153", "pq") == null)
  check(AvFormats.videoBitDepth("hevc", "hvc1.2.4.L153.B0") == 10)
  check(AvFormats.videoBitDepth("hevc", "hev1.1.6.L93.B0") == 8)
  check(AvFormats.videoBitDepth("vp9", "vp09.02.10.10") == 10)
  check(AvFormats.videoBitDepth("av1", "av01.0.04M.10") == 10)
  check(AvFormats.videoBitDepth("h264", "avc1.6E0028") == 10) // High 10
  check(AvFormats.videoBitDepth("h264", "avc1.640028") == 8)

  // A TV whose receiver takes TrueHD and DTS-HD keeps Atmos and DTS:X objects intact.
  val receiver = AvFormats.audioOutput(setOf("dts-hd", "truehd", "eac3", "ac3", "eac3-joc", "dts"), 8, 192000, floatPcm = true)
  check(receiver["passthrough"] == listOf("ac3", "eac3", "eac3-joc", "truehd", "dts", "dts-hd"))
  check(receiver["immersive"] == listOf("eac3-joc", "truehd-atmos", "dtsx"))
  check(receiver["lossless"] == true && receiver["maxSampleRate"] == 192000)
  val phone = AvFormats.audioOutput(emptySet(), 2, null, floatPcm = true)
  check(phone["immersive"] == emptyList<String>() && phone["lossless"] == false && !phone.containsKey("maxSampleRate"))
  check(AvFormats.audioOutput(emptySet(), 8, 48000, floatPcm = true)["lossless"] == true) // 7.1 float PCM
  check(AvFormats.dolbyVisionProfiles(setOf(0x20, 0x100), convertsProfile7 = false) == listOf("5", "8.1", "8.4"))
  check(AvFormats.dolbyVisionProfiles(setOf(0x20, 0x100), convertsProfile7 = true) == listOf("5", "7", "8.1", "8.4"))
  check(AvFormats.dolbyVisionProfiles(setOf(0x20), convertsProfile7 = true) == listOf("5"))

  // TrueHD access unit: 4-byte header, then the major sync (sync, format info, signature/flags/reserved,
  // vbr/peak rate, then substreams and substream info).
  fun accessUnit(rate: Int, substreams: Int, info: Int) = ByteArray(4) + byteArrayOf(
    0xf8.toByte(), 0x72, 0x6f, 0xba.toByte(), (rate shl 4).toByte(), 0, 0, 0,
    0xb7.toByte(), 0x52, 0, 0, 0, 0, 0, 0, (substreams shl 4).toByte(), info.toByte(),
  ) + ByteArray(12)
  val atmos = TrueHdSync.parse(accessUnit(0, 4, 0x80))!!
  check(atmos.atmos && atmos.sampleRate == 48000 && atmos.substreams == 4)
  check(!TrueHdSync.parse(accessUnit(1, 3, 0x00))!!.atmos)
  check(TrueHdSync.parse(accessUnit(1, 3, 0x00))!!.sampleRate == 96000)
  check(TrueHdSync.parse(accessUnit(8, 3, 0x00))!!.sampleRate == 44100)
  check(TrueHdSync.parse(ByteArray(40)) == null)
  check(TrueHdSync.parse(ByteArray(10)) == null)

  val look = SubtitleLook().updated("subtitleSize=xl")!!.updated("subtitlePosition=raised")!!
  check(look.size == "xl" && look.position == "raised" && look.bottomFraction > SubtitleLook().bottomFraction)
  check(look.textFraction > SubtitleLook().textFraction)
  check(SubtitleLook().updated("subtitleSize=huge") == null)
  check(SubtitleLook().updated("offsetSeconds=2") == null)
  check(SubtitleLook().updated("subtitleColor") == null)
  val stored = mapOf("subtitleColor" to "yellow", "subtitleBackground" to "nonsense")
  check(SubtitleLook.from { stored[it] } == SubtitleLook(color = "yellow"))
  check(SubtitleLook().snapshot["offsetSeconds"] == 0.0)
  // Subtitle delay: the web's subtitleOffset grammar, ten minutes either way, never stored.
  val later = SubtitleLook(color = "yellow").updated("subtitleOffset=1.5")!!
  check(later.offsetSeconds == 1.5 && later.color == "yellow" && later.snapshot["offsetSeconds"] == 1.5)
  check(later.updated("subtitleOffset=-0.25")!!.offsetSeconds == -0.25)
  check(later.updated("subtitleOffset=-0")!!.offsetSeconds == 0.0)
  check(later.updated("subtitleOffset=600")!!.offsetSeconds == 600.0)
  check(later.updated("subtitleOffset=601") == null && later.updated("subtitleOffset=1e3") == null)
  check(later.updated("subtitleOffset=") == null && later.updated("subtitleOffset=0.1234") == null)
  check(later.updated("subtitleSize=large")!!.offsetSeconds == 1.5) // appearance keeps the delay
  check("offsetSeconds" !in later.stored && later.stored["subtitleColor"] == "yellow")
  // Output preferences: the Apple player's command and report shape, Android's choices.
  val output = OutputPreferences()
  check(output.values == mapOf("passthrough" to "auto", "dolbyVision" to "auto") && !output.decodeAll && !output.baseLayer)
  val decoded = output.updated("passthrough=off")!!
  check(decoded.decodeAll && decoded.values["passthrough"] == "off")
  check(output.updated("dolbyVision=base-layer")!!.baseLayer)
  check(output.updated("surround=lossless") == null && output.updated("passthrough=on") == null && output.updated("passthrough") == null)
  check(output.available(routePassthrough = true) == listOf("passthrough", "dolbyVision"))
  check(output.available(routePassthrough = false) == listOf("dolbyVision"))
  check(output.available(routePassthrough = false, television = true) == listOf("passthrough", "dolbyVision"))
  check(decoded.available(routePassthrough = false) == listOf("passthrough", "dolbyVision")) // can be turned back on
  val storedOutput = mapOf("passthrough" to "off", "dolbyVision" to "nonsense")
  check(OutputPreferences.from { storedOutput[it] } == OutputPreferences(passthrough = "off"))
  // Playback speed: the web's choices; live and undecoded audio stay at 1×.
  check(PlaybackSpeed.offered(live = false, passthrough = false) == listOf(0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0))
  check(PlaybackSpeed.offered(live = true, passthrough = false).isEmpty() && PlaybackSpeed.offered(live = false, passthrough = true).isEmpty())
  check(PlaybackSpeed.refusal(1.5, live = false, passthrough = false) == null)
  check(PlaybackSpeed.refusal(1.5, live = true, passthrough = false) != null)
  check(PlaybackSpeed.refusal(2.5, live = false, passthrough = false) != null && PlaybackSpeed.refusal(0.25, live = false, passthrough = false) != null)
  check(PlaybackSpeed.refusal(null, live = false, passthrough = false) != null && PlaybackSpeed.refusal(Double.NaN, live = false, passthrough = false) != null)
  check(PlaybackSpeed.refusal(1.25, live = false, passthrough = true) != null && PlaybackSpeed.refusal(1.0, live = false, passthrough = true) == null)
  // The picture-in-picture window takes the video's shape within Android's 2.39:1 either way.
  check(PictureInPictureShape.ratio(1920, 1080) == (1920 to 1080))
  check(PictureInPictureShape.ratio(1920, 804) == (1920 to 804)) // scope, just inside
  check(PictureInPictureShape.ratio(1920, 800) == (239 to 100)) // 2.4:1, just outside
  check(PictureInPictureShape.ratio(3840, 1200) == (239 to 100) && PictureInPictureShape.ratio(500, 1300) == (100 to 239))
  check(PictureInPictureShape.ratio(0, 1080) == null && PictureInPictureShape.ratio(1920, 0) == null)
  // Dolby Vision Profile 7: native where a decoder takes it, 8.1 where one takes Profile 8, else HDR10.
  check(DolbyVision.plan(7, setOf(DolbyVision.PROFILE_7, DolbyVision.PROFILE_8), canConvert = true) == DolbyVisionAction.KEEP)
  check(DolbyVision.plan(7, setOf(DolbyVision.PROFILE_8), canConvert = true) == DolbyVisionAction.CONVERT_TO_81)
  check(DolbyVision.plan(7, setOf(DolbyVision.PROFILE_8), canConvert = false) == DolbyVisionAction.BASE_LAYER)
  check(DolbyVision.plan(7, emptySet(), canConvert = true) == DolbyVisionAction.BASE_LAYER)
  check(DolbyVision.plan(8, emptySet(), canConvert = true) == DolbyVisionAction.KEEP) // Media3 falls back to HEVC itself
  check(DolbyVision.plan(5, emptySet(), canConvert = true) == DolbyVisionAction.KEEP)
  // The viewer's base-layer choice: the HDR10/HLG base of Profiles 7 and 8; Profile 5 has none.
  check(DolbyVision.plan(7, setOf(DolbyVision.PROFILE_7), canConvert = true, baseLayer = true) == DolbyVisionAction.BASE_LAYER)
  check(DolbyVision.plan(8, setOf(DolbyVision.PROFILE_8), canConvert = true, baseLayer = true) == DolbyVisionAction.BASE_LAYER)
  check(DolbyVision.plan(5, setOf(DolbyVision.PROFILE_8), canConvert = true, baseLayer = true) == DolbyVisionAction.KEEP)
  check(DolbyVision.profile("dvhe.07.06") == 7 && DolbyVision.profile8Codecs("dvhe.07.06") == "dvhe.08.06")
  check(!DoviNative.available)
  fun nal(vararg bytes: Int) = bytes.map { it.toByte() }.toByteArray()
  val four = nal(0, 0, 0, 1)
  val three = nal(0, 0, 1)
  val vps = nal(0x40, 0x01, 0x0c)
  val slice = nal(0x02, 0x01, 0xd0, 0x00, 0x03, 0x01) // emulation prevention left alone
  val enhancement = nal(0x7e, 0x01, 0x40, 0x01)
  val rpu = nal(0x7c, 0x01, 0x19, 0x08)
  val access = four + vps + three + slice + nal(0) + four + enhancement + four + rpu
  check(DolbyVision.nalUnits(access).size == 4)
  check(DolbyVision.rewrite(access) { null }!!.contentEquals(four + vps + four + slice))
  val converted = nal(0x7c, 0x01, 0x22)
  var seen: ByteArray? = null
  check(DolbyVision.rewrite(access) { seen = it; converted }!!.contentEquals(four + vps + four + slice + four + converted))
  check(seen!!.contentEquals(rpu))
  check(DolbyVision.rewrite(four + vps + four + slice) { null } == null)
  // Matroska ASS samples as MatroskaExtractor emits them, for libass.
  val (duration, chunk) = AssSample.parse("Dialogue: 0:00:00:00,0:00:02:50,3,0,Default,,0,0,0,,{\\pos(1,2)}Hi, there".toByteArray())!!
  check(duration == 2500L && String(chunk) == "3,0,Default,,0,0,0,,{\\pos(1,2)}Hi, there")
  check(AssSample.timecodeMs("1:02:03:04") == 3_723_040L && AssSample.timecodeMs("0:00:01.50") == 1500L)
  check(AssSample.parse("Comment: 0:00:00:00,0:00:01:00,x".toByteArray()) == null)
  check(AssSample.parse("Dialogue: 0:00:00:00".toByteArray()) == null)
  check(AssSample.parse("Dialogue: 0:00:00:00,bad,x".toByteArray()) == null)
  // Matroska attachments: found through the SeekHead, or before the first Cluster; fonts only.
  fun ebmlId(id: Long) = (if (id > 0xffffff) 4 else if (id > 0xffff) 3 else if (id > 0xff) 2 else 1).let { n -> ByteArray(n) { ((id shr (8 * (n - 1 - it))) and 0xff).toByte() } }
  fun el(id: Long, body: ByteArray) = ebmlId(id) + byteArrayOf(0x01, 0, 0, 0, 0, 0, 0, 0).also { size -> // 8-byte size
    for (i in 0 until 7) size[7 - i] = ((body.size.toLong() shr (8 * i)) and 0xff).toByte()
  } + body
  val unknownSize = byteArrayOf(0x01, 0xff.toByte(), 0xff.toByte(), 0xff.toByte(), 0xff.toByte(), 0xff.toByte(), 0xff.toByte(), 0xff.toByte())
  val font = ByteArray(300) { (it * 7).toByte() }
  val attachmentsEl = el(0x1941A469, el(0x61A7, el(0x466E, "Fancy.TTF".toByteArray()) + el(0x4660, "application/octet-stream".toByteArray()) + el(0x465C, font)) +
    el(0x61A7, el(0x466E, "cover.jpg".toByteArray()) + el(0x4660, "image/jpeg".toByteArray()) + el(0x465C, ByteArray(10))))
  val info = el(0x1549A966, ByteArray(40))
  fun seekHead(position: Int) = el(0x114D9B74, el(0x4DBB, el(0x53AB, ebmlId(0x1941A469)) + el(0x53AC, byteArrayOf(0, 0, 0, position.toByte()))))
  val cluster = el(0x1F43B675, ByteArray(8))
  // SeekPosition counts from the Segment's data: the SeekHead, then Info, then Attachments.
  val withAttachments = el(0x1A45DFA3, ByteArray(4)) + ebmlId(0x18538067) + unknownSize +
    seekHead(seekHead(0).size + info.size) + info + attachmentsEl + cluster
  fun reader(file: ByteArray): (Long, Int) -> ByteArray? = { position, length ->
    if (position >= file.size) null else file.copyOfRange(position.toInt(), minOf(file.size, position.toInt() + length))
  }
  val found = MatroskaAttachments.fonts(reader(withAttachments))
  check(found.size == 1 && found[0].name == "Fancy.TTF" && found[0].data.contentEquals(font)) // by extension, not MIME type
  val noSeek = el(0x1A45DFA3, ByteArray(4)) + ebmlId(0x18538067) + unknownSize + info + attachmentsEl + cluster
  check(MatroskaAttachments.fonts(reader(noSeek)).map { it.name } == listOf("Fancy.TTF"))
  val afterCluster = el(0x1A45DFA3, ByteArray(4)) + ebmlId(0x18538067) + unknownSize + info + cluster + attachmentsEl
  check(MatroskaAttachments.fonts(reader(afterCluster)).isEmpty()) // without a SeekHead, nothing past the first Cluster
  check(MatroskaAttachments.fonts(reader(ByteArray(64))).isEmpty())
  check(MatroskaAttachments.isFont(MatroskaAttachment("a.bin", "font/otf", ByteArray(0))))
  println("Android formats, display matching, subtitle appearance and output preferences passed")
}
