# Vela on Apple TV

Owner: the tvOS lead (`thr_dqxzwab7q6`).

Status: **stopped** (2026-11-16, owner decision). Vela moves to React Native + Expo and native playback
to a libmpv-based Expo module (`docs/rn-migration.md`). This records what the Exact tvOS work built and learned.
The Swift module, `tools/tvos.ts` and VelaMedia stay as a reference until the Expo app replaces them.

What was reached: the app built for tvOS with Exact's Apple host and installed on the Apple TV "Basement".
It was not launched there (the TV was in use), and no title was played on the device.
The lab Ether does offer originals to these capabilities: 1917 (4K HEVC Main10 HDR10 with Dolby Vision
profile 7, TrueHD Atmos 7.1, PGS) and Inception (DTS) got a ready `primary` path, `direct`, `file`,
`original: true`, `range: true`, so nothing would be transcoded.

## What runs where

The tvOS app is the same Exact app as the web client.
Exact's Apple host runs it natively: the Contract view (foundation and the skin-document renderer)
is drawn with UIKit, and the data module (`client/app.ts`, sign-in, Home, libraries, title pages)
runs in Hermes on the device.

The web client also uses six native views from `client/modules/web/index.js`.
On tvOS they are Swift (`client/modules/apple/*.swift`):

| View | Web | tvOS |
|---|---|---|
| `vela-player` | the TypeScript engine (MSE, WebGPU core) | the native engine below |
| `vela-context` | `location.origin`, codec probes, `navigator.connection` | the build's Ether origin, the device's capabilities, no save-data |
| `vela-preview` | a muted `<video>` | AVPlayer, muted and looping |
| `vela-theme` | injects the document's CSS, fonts and keyframes | nothing to inject; see "Skins" |
| `vela-engine` | per-engine page hand-off | nothing (and it is being deleted with the compiled skins) |
| `vela-install` | the PWA install prompt | nothing: a television installs from the App Store |

The view contract is unchanged: the same props (`plan`, `mediaAuth`, `playerCommand`, `serverError`)
and the same messages (`snapshot`, `observation`, `error`, `session-command`).
The foundation cannot tell which engine it is talking to.

## The native player

`vela-player` plays an original the server offers by byte range without any server conversion.

1. **Bytes.** `VelaRangeReader` reads the original over HTTP with one open-ended `Range` request,
   restarting it only when the demuxer jumps (the index at the end of a file, a seek).
   Ether's broker URLs need no header; Plex and Jellyfin get their scoped media headers.
2. **Demux.** `VelaMedia.framework` is FFmpeg 7.1.2's libavformat (Matroska, MP4/MOV, MPEG-TS)
   with a small C shim (`native/apple/media/vela_media.c`).
   It is LGPL-2.1-or-later only, built by `native/apple/media/build-ffmpeg.sh` from a hash-pinned source tarball,
   and linked as a separate, replaceable dynamic framework; its source and licence travel with the binary.
3. **Video.** Compressed H.264 and HEVC samples go to `AVSampleBufferDisplayLayer`, which decodes them in hardware
   (VideoToolbox). The format description carries the colour primaries, transfer function, matrix,
   HDR10 mastering display and content light level, so HDR10 and HLG present as HDR.
   Dolby Vision profiles 5 and 8 are presented as Dolby Vision (`dvh1` with its `dvcC`/`dvvC`).
   Profile 7 (UHD Blu-ray, dual layer) presents its HDR10 base layer: the enhancement layer and RPU are dropped.
   If the device refuses Dolby Vision, the engine falls back to the base layer at the same position.
4. **Display.** With Match Content on (Settings › Video and Audio), the engine asks `AVDisplayManager`
   for the content's dynamic range and frame rate before the first frame, and waits out the mode switch.
5. **Audio.** AC-3 and E-AC-3 go to `AVSampleBufferAudioRenderer` as they are: tvOS decodes them, and passes
   Dolby Atmos in E-AC-3 on to an Atmos sink as the platform allows.
   DTS, DTS-HD MA, TrueHD (with its Atmos bed), AAC, FLAC, Opus, Vorbis, MP3 and PCM are decoded by FFmpeg
   to float PCM in their own channel layout (up to 7.1) and rendered by the same renderer.
   Video and audio share one `AVSampleBufferRenderSynchronizer` clock.
6. **Subtitles.** Embedded PGS, DVD and DVB bitmaps and SubRip, ASS (text only) and tx3g text are decoded by FFmpeg
   and drawn as an overlay. Every subtitle stream's packets are kept as they are read, so a track switch shows the
   current cue at once. A server-converted WebVTT track is fetched and drawn the same way.
7. **Tracks.** An audio or subtitle track the original carries switches on the device, without a new plan
   (reported as client-only, as the web core does). Other changes go to the server as `tracks` commands.
8. **Seeks** move the clock at once and are sent to the server as `seek` commands; the confirming plan's
   new seek generation is recognised and not applied twice.

Anything that is not an original file (the server's remux or conversion HLS) plays in AVPlayer
(`VelaHLSBackend`), reported as backend `native-hls`. AVPlayer handles its own display matching.

## Capabilities the app declares

`vela-context` (probe `media`) declares, in the web probe's shape:

- `originalPlayback`: containers `mkv webm mp4 mpegts`; video `h264` and `hevc` (when the device has hardware HEVC);
  audio `aac ac3 eac3 dts truehd mlp flac alac opus vorbis mp3 mp2` and PCM; `webgpu: false`.
- For the server's HLS: `mp4` with `h264`/`hevc` and `aac`/`ac3`/`eac3`; `hls: true`, `mse: false`.
- Subtitles: `webvtt ether-vtt-window srt ass ssa pgs tx3g`.
- The device: name and platform `tvos`.

## Building and installing

```sh
export PATH="$PWD/.tools/bun-darwin-aarch64:$PATH"
VELA_TV_ORIGIN=https://<ether-host>:<port> bun tools/tvos.ts --device <udid|name> [--run]
```

`tools/tvos.ts` stages the client on the scratch drive (a real path: Exact refuses symlinked app files),
adds `VelaMedia.xcframework` and `VelaOrigin.swift` (the Ether this build signs in to),
builds with `exact.mjs ios --tvos --device --unsigned`, signs with an installed tvOS development profile
that covers the Apple TV (Exact's own device signing accepts only iOS profiles), and installs with `devicectl`.
`tools/tvos-typecheck.sh` type-checks the Swift against the tvOS SDK in seconds.

Prerequisites: Xcode (`DEVELOPER_DIR`), Rust's `aarch64-apple-tvos` std for the pinned toolchain,
and the Hermes bundle for `aarch64-apple-tvos`.

## Skins

On tvOS the skin-document renderer is the whole UI.
The web renderer binds ten style rows per box inline and leaves the rest, and every hover, press and focus look,
to the document's stylesheet, which `vela-theme` injects. A native host has no stylesheet, so a document would lose
most of its layout and all of its state looks.
A native emission of `tools/renderer.ts` (every row bound inline, focus looks from the focus engine through the
renderer's focus state) was agreed with the skin architect and started, then reverted with the stop:
Exact's `lower-attr-value` check refused a bound `position` on the motion box (`MoBoxEl`) even as a ternary of
`relative`/`absolute`/`sticky`, while the same binding passed on the plain box. Unresolved.

## What was learned

- **Signing.** Exact's device build (`exact.mjs ios --tvos --device`) only accepts iOS provisioning profiles
  (`iosProfile()` in `host/apple/devices.mjs`), so it refuses the team's `tvOS Team Provisioning Profile: *`.
  Build `--unsigned --json`, then embed the tvOS profile, sign nested frameworks inside-out and the app last with
  `application-identifier`, `com.apple.developer.team-identifier`, `get-task-allow` and `keychain-access-groups`
  (`tools/tvos.ts` step 6). The wildcard tvOS profile (team 9YL3YCJTNT) covers Basement (00008110-000238E12ED3801E).
- **Install and screenshots.** `xcrun devicectl device install app --device <udid> <bundle>` installs over the
  network; `devicectl device process launch --terminate-existing <bundle-id>` launches; and
  `devicectl device capture screenshot --device <udid> --destination x.png` captures the TV at 3840x2160.
  `xcrun devicectl list devices --json-output` names Apple TVs by `hardwareProperties.deviceType == appleTV`.
- **Remote control.** pyatv (`atvremote`, Python 3.12; it fails on 3.15) finds Basement over Companion at
  192.168.68.72; pairing shows a PIN on the TV, readable from a devicectl screenshot.
- **Exact on tvOS.** It needs Rust's `aarch64-apple-tvos` std and the Hermes bundle for that target; it refuses
  symlinked static app files anywhere in the app's path (stage on a real path); a staged app's Cargo target
  directory must not move between paths. The focus engine reports focus and blur, Select presses, Menu goes back.
- **HDR and frame rate.** `UIWindow.avDisplayManager.preferredDisplayCriteria = AVDisplayCriteria(refreshRate:
  formatDescription:)` (only when `isDisplayCriteriaMatchingEnabled`, the viewer's Match Content), then wait while
  `isDisplayModeSwitchInProgress` before the first frame. The format description must carry the colour
  extensions (primaries, PQ/HLG transfer, matrix, mastering display volume, content light level) and, for Dolby
  Vision, codec type `dvh1` with `dvcC` (profile 5) or `dvvC` (profile 8). Profile 7 presents its base layer.
- **Audio.** `AVAudioSession` `.playback`/`.moviePlayback`, `setSupportsMultichannelContent(true)` and
  `setPreferredOutputNumberOfChannels(maximumOutputNumberOfChannels)` for up to 7.1 PCM over HDMI.

## Known gaps (when stopped)

- Document fonts (`fontsJson`) are not registered natively yet; text falls back to the system font.
- Dolby Vision profile 7's enhancement layer is not reconstructed (as on every Apple device); its base layer plays.
- TrueHD and DTS:X objects are rendered as their channel bed, not as Atmos or DTS:X.
- Live TV plays through AVPlayer on the server's HLS; the native engine is for originals.
- The Exact agent has no tvOS target, so drives are by hand on the device.
