# Linux native playback

`host.js` implements `NATIVE_PLAYER.md`. The helper uses libmpv's LGPL render
API in a host-owned EGL/X11 window beneath Electron. It does **not** use mpv's
built-in X11 VO: mpv 0.41 gates that backend on GPL. XWayland is supported via
Electron's X11 platform. A compositing window manager is required for transparent
Electron content; no compositor means the browser fallback must be used.

HDR sources are tone-mapped by mpv to sRGB/BT.709. Native Wayland surfaces and
HDR signaling (`target-colorspace-hint`) are not implemented. VA-API/VDPAU/NVDEC
availability depends on the audited FFmpeg build, driver and codec. Hardware
failures can fall back to software decode. Audio passthrough is requested for
AC3/EAC3/DTS/DTS-HD/TrueHD; actual output depends on the audio device/server.
ASS/PGS decoding and rendering belong to libmpv/libass.

Media uses an ephemeral loopback proxy. Only exact-origin, path-boundary URLs
receive immutable grant headers. Redirects are checked before each request;
HLS playlist references are rewritten through opaque registered routes. Grant
replacement closes existing connections immediately. Credentials never enter
mpv options or events. Live playback stays at rate 1; no catch-up is issued.

## Packaging

Build audited LGPL FFmpeg with shared libraries, GPL/nonfree disabled, and
libmpv with `-Dgpl=false -Dlibmpv=true -Dcplayer=false`. Enable the OpenGL render
API, EGL, audio outputs and desired FFmpeg hardware accelerators. Do not enable
mpv's built-in X11 VO. Build on the oldest supported distribution; binaries
built on Ubuntu 26.04 do not establish compatibility with older glibc versions.

`VELA_LGPL_PREFIX=/audited/prefix node linux/build.mjs` builds `native-linux/`.
The prefix must contain `include/`, `lib/`, `notices/` and `provenance.json`:

```json
{
  "mpv": { "version": "0.41.0", "gpl": false },
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
