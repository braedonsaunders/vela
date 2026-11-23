# Android Media3 verification, 18–19 November 2026

The migration is implemented and signed builds are available, but real-tablet
verification is incomplete. This document distinguishes emulator evidence from
physical HDR, HDMI and tablet performance claims.

## Builds

Both variants were built and signed on bb-worker-server with
`tools/android-release.sh`, followed by incremental signed Gradle builds for
fixes. Both include arm64-v8a and x86_64 and the LGPL-only FFmpeg audio extension.
APK inspection finds no mpv library. Signing credentials stayed on the worker.
Normal APKs contain the application entry; the lab bootstrap and playback probe
are separate private test APKs and are not distribution artifacts.

| APK | Before (0.2.16), bytes | After (0.2.18), bytes |
| --- | ---: | ---: |
| Phone/tablet | 126,756,456 | 75,103,463 |
| Android TV | 126,756,576 | 75,103,583 |

Both APKs are 40.75% smaller than their baselines. Worker artifacts are under
`~/.scratch/tmp/thr_a24pbjswkp/release/`.

| Artifact | SHA-256 |
| --- | --- |
| `Vela-0.2.18-android.apk` | `6bc6e57bf8a3fa860cf1c840121042aaaf85efd49dcdc77f3eeb492b6040e5cc` |
| `Vela-0.2.18-androidtv.apk` | `a5579998d2076e89718e8d40b40a3b0e51cd3d4a7dddf0a631ea9d63be310a2c` |

Both normal APKs were reinstalled after restoring the emulator saved sessions.
The phone variant has no Leanback entry; the TV variant has its Leanback launcher.
Private probe APKs and temporary session configurations were removed.

## Runtime checks

| Device | Observed evidence |
| --- | --- |
| Worker phone emulator | Camp Crystal original H.264/EAC3 visible; original TrueHD fixture advances; FFmpeg DTS decoding on Fall's negotiated 1080p H.264 version advances past 70 seconds. |
| Worker phone emulator | Embedded SRT, authenticated external SRT, external WebVTT selected initially over DASH, and Off visibly render/clear; audio selection advances continuously without reloading. |
| Worker phone emulator | An injected FFV1+AAC original URL (unsupported video with playable audio) requests one real advertised server transcode; the returned HEVC HLS picture advances beyond 30 seconds. The server transcodes the session's catalogue source, rather than the injected fixture. |
| Worker phone emulator | Full application player chrome wakes on tap and hides after idle; live SHIFT 10 plays full screen; compact navigation scrolls destinations and Recommended/Library in one row with a complete selected-pill border. |
| Worker TV emulator | Camp Crystal visible; decoder logs identify FFmpeg EAC3. A TrueHD fixture plays to 15 seconds with `ffmpegLavc60.3.100-truehd`. Refused-file recovery reaches advancing server HLS video. |
| Worker TV emulator | Embedded/external SRT and Off render/clear, audio choices succeed without source reload, and authenticated MP4/DASH fixtures advance to 15 seconds. Requests for manifests, initialization data and media segments retain the fixture grant. |
| Worker TV emulator | Guide browsing from CHROMA 80 to SHIFT 10 leaves CHROMA playing and creates no extra tune request. Preview audio-focus stack is empty. Select opens SHIFT full screen and obtains media audio focus. Dedicated Channel Down changes to CHROMA with visible video. Playback is closed after checks. |
| MediaPad M3, LineageOS 20 | An earlier Media3 build installed in verified 8 MiB chunks; compact Home navigation was inspected. The latest fixes and CPU profile remain unverified: the confirmed wireless ADB port repeatedly refuses or times out from both hosts. The owner requested Wi-Fi only. |

Fall's original 4K HEVC HDR stream reported BT.2020/PQ/Main10 and TrueHD, but the
emulator decoder rejected its resolution/profile. The first fallback delivery
subsequently timed out. A later independent server check returned an HLS manifest
and stopped its proof session; later capability negotiation selected the compatible
1080p H.264/DTS version. These are not proof of 4K HDR display output. HDR10/HLG/DV,
HDMI passthrough, effective display-mode matching and tunneling need appropriate
physical hardware. Direct raw external SUP/IDX/SUB remains a server-conversion
case, not a claim of native external-bitmap parity.

Both emulators report H.264, HEVC and VP9 decoder profile/level records, a
4,096 × 2,160 maximum supported resolution pair and `hdr: []`. Their Goldfish
codecs are classified as hardware by Android; that virtual classification does
not establish physical HDR capability.

## CPU evidence and fixes

Hermes sampling on the phone emulator found 50 of 214 active samples inside
synchronous secure-store reads, including 49 native `getValueWithKeySync` samples.
A write-through process cache removes repeat native reads while preserving durable
writes, sign-out and failure behavior. In the next 25-second watch capture those
read stacks were absent; active samples were 129/2,016 (6.4%) versus 214/1,857
(11.5%) before. These are sampled emulator results, not a measured tablet speedup.
The native adapter is shared by Apple and Android, and the finding was sent to
the parent thread.

Preview paint updates now occur only when visibility changes, rather than once
per decoded frame. Compact shell publication uses a stable page model. Settled
Home JavaScript was largely idle; an initial library load spike is not presented
as sustained CPU use. A later emulator input ANR had the main thread waiting on
HWUI and RenderThread blocked in emulator `glCreateProgram_enc`/`qemu_pipe_read`,
with JavaScript idle; the library loaded after relaunch and warm-up.

## Automated checks

The pinned Bun 1.4.2 directory must lead PATH: an absolute `bun run` alone allowed
its nested `bun test` to resolve an older PATH Bun. With PATH corrected,
`bun run typecheck`, `bun run test` and `bun run check:skins` pass. The latest suite
has 627 passing tests and one local JVM-probe skip.

The production Kotlin scoped HTTP, recovery, subtitle identity/ownership, error
classification and capability policy probes pass on the worker JVM. They cover
encoded/space-containing grant prefixes, nested encoded traversal, same-scope
redirects, off-prefix and cross-origin redirects returning to scope
without restoring headers, grant rotation, range responses, HTTP refusal,
redirect bounds, untried plan paths, one fallback preparation, missing video with
playable audio, external delivery-format priority and display/decoder HDR gating.

## Remaining device work

Install the final normal APK on the MediaPad once wireless ADB responds, using
8 MiB verified chunks, then capture its real CPU/thread trace and inspect playback,
tap controls, subtitle switching, compact/landscape headers and live handoff.
Physical HDR/HDMI proof is reserved for HDR-capable Android TV hardware. Raw
external bitmap sidecars require a supported server delivery/burn-in path or a
future sidecar metadata contract; native embedded bitmap support does not prove
that external-file case.

## Commit landmarks

- `8410d50a`: sole Media3 engine, scoped access, bounded recovery and Android mpv removal.
- `0d567509`: limit the combined navigation to compact layouts.
- `dd5df464`: cache native secure-store reads with durable writes.
- `d4e3b266`, `72870e05`: overlaid Android video/subtitles and working touch chrome.
- `808f8a37`: TV channel buttons use live tuning.
- `1cad3edf`: recover when an extractor keeps audio but drops unsupported video.
- `84fb8484`, `22aaa4eb`: decoder limits and display/decoder HDR intersection.
- `115563b2`: encoded grant prefixes and nested traversal rejection.

The branch is based on `origin/main` at `7b73e593`; no commits were pushed.

# Audio/video formats, 22–23 November 2026

Branch `bb/av-formats-android-and-android-tv-thr_6ekp6jirfq`. Built for the API 36
Android TV emulator (x86_64, `-gpu swangle_indirect -feature -HardwareDecoder`) on
bb-worker-server, against the mock with format fixtures made by ffmpeg 7.1, mkvmerge
and dovi_tool 3.4.0 (libdovi's own Profile 7 FEL RPU, an enhancement layer muxed in as
NAL 63, mkvmerge's `dvcC` record: profile 7, BL compatibility 6). Logcat tag
`vela-media3` gives every result below; `format {...}` lines are Snapshot.format.

| Check | Emulator evidence |
| --- | --- |
| Dolby Vision Profile 7 FEL MKV, no DV decoder | `dolby vision profile 7: BASE_LAYER`; the HEVC decoder gets the base layer with RPU and EL removed and plays mid-file. Card: source `dv`/`7`, output `hdr10`, `dvConversion: base-layer`. A 10-bit base layer cannot be tested: the emulator's software HEVC decoder refuses Main 10 with or without Dolby Vision. |
| libdovi bridge | `libvela_dovi.so` loads in the APK (`profile 7 conversion true`). On the host JVM the same bridge is byte-exact with dovi_tool's expected outputs (MEL to 8.1; FEL through MEL to 8.1). The 8.1 path itself needs a Profile 8 decoder. |
| FLAC 7.1 24-bit 96 kHz | AudioTrack `encoding 4` (float) mask `0x18fc` (7.1) 96000 Hz; AudioFlinger shows the float 7.1 96 kHz track. The emulator mixer folds it to 2 ch/48 kHz, and the card says `downmixed`, not lossless. |
| TrueHD 5.1 | `truehd major sync: atmos false`; `ffmpegLavc60.3.100-truehd` decodes to float 5.1 (`mask 0xfc`). |
| Frame-rate facts | 23.976 from the server's probe; `frameRateMatch: unsupported` (one 60 Hz mode). |
| HDR to SDR request | `tone mapping requested; decoder cannot map` (software decoder); card `toneMapped: false`, `range: hdr10`. |
| Styled ASS (libass) | `\pos`+`\frz`, outlined style, `\move` with `\3c` border, `\k` karaoke and inline overrides render as authored, in step with the burned-in frame time. |
| Embedded SRT after the transcoding move | Media3 cues render, italics included. |

## Needs real hardware

Shield TV (Pro, Android 11) on HDMI to an Atmos/DTS:X AV receiver (eARC or direct), with
the receiver's front-panel format display visible:

1. TrueHD Atmos MKV: the receiver shows Dolby Atmos (TrueHD); logcat `audio output
   encoding 14` (ENCODING_DOLBY_TRUEHD), card `delivery: passthrough`, `immersive: atmos`,
   profile `Dolby TrueHD + Atmos`.
2. DTS-HD MA / DTS:X: receiver shows DTS-HD MA / DTS:X; `encoding 8` (DTS_HD).
3. E-AC-3 JOC: receiver shows Dolby Atmos (DD+); `encoding 18`.
4. With passthrough off in Shield settings (or a PCM-only receiver): TrueHD 7.1 arrives as
   8-channel PCM; the receiver's multichannel PCM indicator; card `decoded`, `lossless:
   true` for 24-bit sources. Check the `tunneling` value in the `audio output` line.
5. 23.976 MKV: the TV/receiver reports 23.976/24p on start, back to the UI rate on exit;
   card `frameRateMatch: matched`. Repeat 25/50 and 29.97/59.94.
6. Dolby Vision TV: a Profile 7 FEL/MEL UHD-BD remux shows the TV's Dolby Vision badge
   (`dolby vision profile 7: CONVERT_TO_81` if the Shield has a Profile 8 decoder only,
   `KEEP` if it lists Profile 7). Profile 8.1 and 5 files show Dolby Vision as well.
7. HDR10+ title on an HDR10+ TV (Samsung): HDR10+ badge.

A Chromecast with Google TV or Fire TV 4K Max: the same audio checks (Fire TV HALs often
lack TrueHD/DTS-HD encodings, so those decode to PCM until an IEC 61937 path exists), and
Android 12+ match-content behaviour with the system setting on Always, then Seamless only.
An Android 13+ phone with an SDR panel: an HDR10 file reports `toneMapped: true` where the
decoder supports it. Each check is read from logcat (`adb logcat -s vela-media3`).
