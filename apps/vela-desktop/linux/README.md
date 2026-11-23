# Linux native playback

`host.js` implements `NATIVE_PLAYER.md`. The helper uses libmpv's LGPL render
API in a host-owned EGL/X11 window beneath Electron. It does **not** use mpv's
built-in X11 VO: mpv 0.41 gates that backend on GPL. XWayland is supported via
Electron's X11 platform. A compositing window manager is required for transparent
Electron content; no compositor means the browser fallback must be used.

Rendering uses mpv's **gpu-next** renderer (libplacebo) through the render API. That renderer
reached the render API after mpv 0.42.0, so the payload pins mpv master at commit
3e8aa53ec1. mpv 0.41/0.42's render API only had the old `gpu` renderer, which drops the
Dolby Vision mapping: Profile 5 showed green and purple. libplacebo applies every Dolby
Vision profile's RPU (5, 8.1, 8.4; 7 from its base layer and RPU) and uses HDR10+ dynamic
metadata. X11 has no HDR signalling, so HDR10, HDR10+, HLG and reshaped Dolby Vision are
tone-mapped to SDR BT.709. HDR is not advertised to the server; `dolbyVisionReshape` is.
The helper prints the renderer it got (`ready gpu-next`). It falls back to `gpu` only for a
GL driver libplacebo cannot use. Native Wayland surfaces, HDR output and display-mode
(refresh-rate) switching are not implemented; the info card reports them as `unsupported`.

VA-API/VDPAU/NVDEC availability depends on the audited FFmpeg build, driver and codec.
dav1d provides software AV1, because FFmpeg's own AV1 decoder is hardware-only.
`deinterlace=auto` deinterlaces interlaced frames only. libmpv/libass render ASS/SSA with
styling, and mpv draws PGS, VobSub and DVB bitmaps. The player menu's subtitle size,
colour, background and position reach mpv as `sub-*` properties.

Audio follows `playback.json` in Electron's user-data folder, with the same fields as
Windows (`passthrough`, `exclusive`, `audioDevice`):

- Through PulseAudio/PipeWire (the default), mpv tries AC-3/E-AC-3/DTS/DTS-HD/TrueHD
  passthrough and decodes when the sink refuses. The default sink's channel count is what
  the server is told.
- For bit-perfect output and HDMI high-bit-rate passthrough (TrueHD Atmos, DTS-HD MA/DTS:X),
  name a direct ALSA device, e.g. `"audioDevice": "alsa/hdmi:CARD=NVidia,DEV=0"`. The
  receiver's HDMI ELD (`/proc/asound/<card>/eld#*`) then decides which bitstreams are
  attempted and claimed. A direct device has no mixer, resampler or volume stage.
- FFmpeg decodes anything not passed through, losslessly for TrueHD and DTS-HD MA, without
  Atmos/DTS:X objects.

Media uses an ephemeral loopback proxy. Only exact-origin, path-boundary URLs
receive immutable grant headers. Redirects are checked before each request;
HLS playlist references are rewritten through opaque registered routes. Grant
replacement closes existing connections immediately. Credentials never enter
mpv options or events. Live playback stays at rate 1; no catch-up is issued.

## Packaging

Build audited LGPL FFmpeg with shared libraries, GPL/nonfree disabled, and
libmpv with `-Dgpl=false -Dlibmpv=true -Dcplayer=false`, plus dav1d (BSD-2-Clause) for software AV1. Enable the OpenGL render
API, EGL, audio outputs and desired FFmpeg hardware accelerators. Do not enable
mpv's built-in X11 VO. The required compiler baseline is Ubuntu 22.04 (glibc 2.35), provided by
`linux/Dockerfile.jammy`. Compile **both** the libraries and helper inside that
baseline; running the helper compiler on a newer host can reintroduce new symbols.
`build-libraries.sh` builds pinned libplacebo with its OpenGL backend, avoiding a
newer system libplacebo/Vulkan dependency. It also installs pinned NVDEC headers.
The image provides compiler/runtime dependencies; supply a Node 18+ build-tool
binary that itself runs on Ubuntu 22.04 (official Node 24 was used for verification).
Use a dedicated named container and remove only that container afterward.

The packager runs `objdump -T` over every native ELF and rejects GLIBC requirements
above 2.35, private GLIBC symbols and additional loader ABIs. Recheck the whole
unpacked application and launch the AppImage inside the baseline before delivery:

```sh
node linux/audit-glibc.mjs dist/linux-unpacked
node linux/audit-glibc.mjs --json native-linux > native-abi.json
# In the named Ubuntu 22.04 container, under Xvfb + a compositing WM:
./Vela-<version>-linux-x86_64.AppImage --appimage-extract-and-run --no-sandbox
```

`VELA_LGPL_PREFIX=/audited/prefix node linux/build.mjs` builds `native-linux/`.
The prefix must contain `include/`, `lib/`, `notices/` and `provenance.json`:

```json
{
  "mpv": { "version": "git-3e8aa53ec1", "gpl": false },
  "ffmpeg": { "version": "8.0.1", "gpl": false, "nonfree": false },
  "sources": [{ "url": "https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz", "sha256": "05ee0b03119b45c0bdb4df654b96802e909e0a752f72e4fe3794f487229e5a41" }],
  "libraries": ["libmpv.so.2", "libavcodec.so.62"]
}
```

List the complete non-platform dependency closure, not just those example
libraries. Include license texts, copyright notices, source archives or a valid
source offer, and exact build instructions for all bundled dependencies.
Distro mpv/FFmpeg builds commonly enable GPL; never put them in the payload.
Pass the resulting directory to the shared packager's `--native-linux=...`.
Without a native payload the desktop remains a browser-only build.

## Verification

Pure logic: `bun test apps/vela-desktop/linux/test`.
Runtime must verify actual frames beneath Electron, seek, tracks, fullscreen,
resize and live stalls. Playback position alone is insufficient: a failed video
output can leave audio playing. The host falls back if a video track exists but
no video output becomes configured within ten seconds.
