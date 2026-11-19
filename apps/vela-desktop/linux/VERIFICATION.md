# Linux native verification — 2026-11-19

Native runtime rebuilt inside a named Ubuntu 22.04.5 container on
`bb-worker-server`; Electron 45.3.3, FFmpeg 8.0.1, libmpv 0.41.0 and pinned
OpenGL libplacebo 6.338.2. The initial playback evidence below was collected on
the worker's Ubuntu 26.04 host; the final portable payload was then separately
launched and exercised inside Ubuntu 22.04 / glibc 2.35. Both media libraries were built with GPL and
nonfree disabled. All six FFmpeg runtime license functions are checked by the
helper; the packaged runtime passes `vela-mpv --audit`. Notices, exact source
archives for FFmpeg/mpv, build options and provenance accompany the libraries.
The Linux-only commits require the Mac owner's shared Electron bridge/UI changes.

## Observed

- **Actual Vela controller:** authenticated against the lab Ether, played Camp
  Crystal original video beneath real Vela chrome; native telemetry reported
  `vaapi-copy`, 1920×1080 H.264. Paused and sought through the actual slider from
  0:04 to 28:02. Electron desktop capture showed film and controls together.
- **Fall:** default source played through the native host at 1920×960 H.264/DTS.
  This is the SDR source, not evidence of 4K HDR tone mapping.
- **Final AppImage:** launched using `--appimage-extract-and-run --no-sandbox`
  under Xvfb, xcompmgr and Openbox; native preload was available. Real lab
  CHROMA 80 live playback produced advancing native snapshots at speed 1.0.
- **Actual live stall:** suspended only this test app's main/proxy process,
  leaving its mpv child running. Buffered playback advanced from 62.73 to 65.70,
  then `paused-for-cache` became true. Resuming the proxy recovered playback to
  67.20; rate was 1.0 before, during and after the stall. The process was resumed
  in a `finally` block. No catch-up or seek-to-edge command was sent.
- **Fullscreen/resize:** final AppImage entered HTML/native fullscreen with a
  1280×720 viewport under Openbox. An independent native harness resized to
  1100×622 content and entered 1280×720 fullscreen; video remained below the
  translucent page. The helper resolves the WM frame before stacking.
- **Tracks:** a generated 30-second Matroska fixture switched AAC audio `aid`
  from 1 to 2, enabled embedded ASS (`sid=1`), visibly rendered styled yellow
  text, and sought to 10 seconds then advanced to 13.79. The lab Camp plan
  offered only one EAC3 audio track and no subtitle alternatives.
- **Recovery/security:** progressive synthetic HLS stalled, buffered and resumed
  at rate 1.0. Revoke/regrant recovered with a fresh native source. Full app
  testing caught an old grant's late `end-file` error; the host now matches the
  current mpv playlist entry before falling back. Browser fallback was observed
  during failed native starts. Six Linux tests cover the GLIBC ceiling, scope boundaries,
  redirects/HLS rewriting, generations, scaling and live rate policy.
- **Debian package:** inspected native runtime/notices in the package, extracted
  without installing system-wide, launched successfully, and confirmed native
  bridge availability. Full playback testing used the AppImage's same payload.
- **Mac checks:** `bun run typecheck` passed (upstream dependency diagnostics
  ignored by the repository runner); `bun run test`: 673 passed, one skipped.
  Linux-specific tests: six passed, 28 assertions.

## Hardware and limits

`vainfo` reports Mesa Gallium 26.0.3 `r600_drv_video.so`, AMD CAICOS / Radeon HD
7450, with H.264/MPEG-2/VC-1 VA-API decode profiles. H.264 `vaapi-copy` was
observed. The packaged FFmpeg enables VA-API, VDPAU and NVDEC; NVIDIA/VDPAU runtime
verification remains pending appropriate hardware. Xvfb rendering used software
OpenGL; native frames and composition were inspected through Electron desktop
capture. `xwd -root` omitted the video layer in this environment and was not used
as final composition evidence.

4K HEVC HDR verification is pending capable hardware, as directed by the
coordinator: this Radeon has no HEVC decode and Ether correctly selects SDR for
an SDR output path. Native Wayland/HDR signaling is not implemented; Wayland
sessions use XWayland, with mpv tone mapping to SDR. HDR output is not advertised.
PGS support and TrueHD/DTS decoding are delegated to the compiled mpv/FFmpeg
codecs; PGS display and audible TrueHD/DTS-HD passthrough were not verified. The
worker has no usable physical audio sink/AVR. The final payload and whole unpacked application were audited with
`objdump -T`: 32 ELF files, maximum GLIBC_2.35. The helper and libmpv require at
most 2.34; FFmpeg libraries at most 2.35, libplacebo at most 2.34 and libass at
most 2.29. The AppImage launched inside Ubuntu 22.04.5, exposed its native bridge,
and played a 640×360 fixture to 7.875 seconds at rate 1.0. Ubuntu 24.04 and Debian
12 were not separately boot-tested; their newer glibc satisfies this symbol
ceiling. The packager rejects newer GLIBC requirements by default.

## Artifacts

Local unsigned test builds, combining the Linux host with the coordinated
shared bridge and renderer (base player payload digest unchanged):

| Artifact | SHA-256 |
| --- | --- |
| Vela-0.2.21-linux-x86_64.AppImage | `b301bdcfb4de845acc512f896287374def1b36be628ef9891662a2c3fce4e2e4` |
| Vela-0.2.21-linux-amd64.deb | `dd134008dc132df8e8afb1acf1166c9e1be1d99951b210740a6667272d77a61e` |

Delivery also includes `native-linux-lgpl.tar.gz` for the shared packager.
No artifacts were pushed or published.
