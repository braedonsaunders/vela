# Windows playback

The page draws Vela's player chrome. libmpv (`libmpv-2.dll`, LGPL) plays the picture in a
native child window behind the transparent WebView2 (`Playback.cs`). Multiview tiles,
ambient previews and trailers stay in the browser engine. Everything else plays through
libmpv, which opens the server's original file (MKV, MP4/MOV, M2TS/TS, AVI, WebM, OGG, FLV,
ASF, RM, MPEG-PS) or its HLS.

## Video

- **Renderer:** `vo=gpu-next` on Direct3D 11 (libplacebo), with D3D11VA hardware decoding
  (`hwdec=auto-safe`; `VELA_HWDEC` overrides it). Software decoding covers what the GPU
  lacks: H.264, HEVC Main/Main10, AV1 (dav1d), VP9, VC-1, MPEG-2, MPEG-4 and others.
- **10-bit:** the path is 10-bit end to end: P010 decode, a 10-bit swapchain in HDR, and
  dithering into 8-bit SDR.
- **HDR10, HDR10+, HLG:** when Windows HDR is on for the monitor, mpv sends PQ BT.2020
  with HDR10 metadata to the display (`target-colorspace-hint`). Otherwise libplacebo
  tone-maps to the SDR display using the stream's own metadata, including HDR10+ dynamic
  metadata. Windows has no per-frame HDR10+ path, so an HDR display receives static HDR10.
- **Dolby Vision 5, 7, 8.1, 8.4:** libplacebo applies the stream's RPU itself, so Profile 5's
  IPT colour is correct. The result goes out as HDR10 or tone-mapped SDR. Windows cannot
  send a Dolby Vision signal, so the card says "reshaped". Profile 7 plays its base layer
  plus RPU, the Profile 8.1 equivalent. A FEL enhancement layer is not decoded.
- **Deinterlacing:** `deinterlace=auto` deinterlaces only frames flagged as interlaced (yadif).
- **Display matching (while fullscreen):** the monitor switches to the film's frame rate:
  23.976 → Windows' 23 Hz mode, which is 24000/1001. Without such a mode it uses the
  fastest exact multiple, such as 119.88 Hz. Windows HDR is turned on for HDR and Dolby
  Vision and off for SDR. Both are undone when fullscreen ends, playback stops or Vela
  closes. Frame-rate changes use `CDS_FULLSCREEN`, which Windows reverts even if Vela
  crashes. The HDR toggle is restored by Vela itself.

## Audio

- **Passthrough:** AC-3, E-AC-3 (with Atmos JOC), DTS, DTS-HD MA/DTS:X and TrueHD (with
  Atmos) are sent to the receiver unchanged as IEC 61937 over WASAPI exclusive mode.
  TrueHD travels inside Dolby MAT frames, the HDMI carriage for TrueHD, so Atmos objects
  reach the receiver intact. Vela first asks the endpoint which bitstreams it accepts
  (`AudioEndpoint.cs`, `IAudioClient::IsFormatSupported`). Windows answers from the HDMI
  sink's EDID, so only those are attempted. S/PDIF optical outputs correctly report AC-3
  and DTS only.
- **Decoded:** anything not passed through is decoded by FFmpeg to multichannel LPCM up to
  7.1, with the correct channel layout. TrueHD and DTS-HD MA decode losslessly. FFmpeg
  gives the TrueHD 7.1 bed without Atmos objects, and the DTS-HD MA channels without DTS:X
  objects.
- **Bit-perfect:** with `"exclusive": true` (below), PCM opens the device exclusively at the
  source's own sample rate and depth. FLAC, ALAC, WAV and AIFF up to 24/192 (and 384 kHz
  where the device takes it) reach the DAC untouched while the volume is 100% and the speed
  is 1×. Shared mode goes through the Windows mixer at its configured rate.
- **What the server is told:** passthrough codecs, maximum channels and the maximum
  unresampled rate come from that probe (`Capabilities.cs`), so Ether keeps lossless and
  immersive tracks.

## Subtitles

libass renders SRT, WebVTT and ASS/SSA with their styling and fonts (DirectWrite). mpv draws
PGS, VobSub and DVB bitmaps. Embedded and external tracks and forced flags follow the plan's
track choice. The player menu's subtitle size, colour, background and position apply to text
subtitles; styled ASS keeps its own look apart from size.

## Settings

`playback.json` in `%LOCALAPPDATA%\Vela` (or `VELA_DATA_DIR`) is read when each title starts:

```json
{
  "passthrough": "auto",
  "exclusive": false,
  "matchFrameRate": true,
  "matchDynamicRange": true,
  "audioDevice": ""
}
```

- `passthrough`: `"auto"` (every bitstream the endpoint accepts), `"off"`, or a list such
  as `["ac3", "eac3", "dts", "dts-hd", "truehd"]`.
- `audioDevice`: a `wasapi/{guid}` name from the report below.

## Info card and report

Each snapshot carries mpv's own facts, mapped once for both desktop platforms by
`modules/vela-player/src/windows/mpv-format.ts`: source codec, profile, bit depth, frame
rate, HDR format and Dolby Vision profile; output range, decoder, display mode and match
state; audio codec, Atmos/DTS:X, channels, rate; passthrough or decoded, MAT, exclusive,
downmix/resample and lossless.

`Vela.exe --av-report report.json` writes what this PC would tell the server: endpoint
probes for every audio device, display mode and HDR, and the libmpv build and its
configuration. It contains no account, server or media data.

## Licensing

`build.ps1` packages the LGPL build of mpv-winbuild-cmake: mpv `-Dgpl=false`, and FFmpeg
without `--enable-gpl`/`--enable-nonfree`, which is LGPLv3 because of `--enable-version3`.
The build refuses a DLL whose recorded configuration lacks `-Dgpl=false` or that links
x265 or rubberband. The previously pinned shinchiro build linked the x264/x265 encoders,
rubberband and dvdnav and was GPL. `licenses/` ships beside the DLL: the licence texts,
provenance and source offer. The DLL is replaceable.

Dolby and DTS: Vela encodes neither. Passthrough forwards the film's own bitstream, and the
receiver holds the decoding licence. Decoding uses FFmpeg's own decoders. Distributors
should take their own advice on the patent position of shipping those decoders.

## Verification

Verified on gpu-workstation (RTX 4080, Windows build 26300) over SSH, in session 0:
- The host builds.
- `--av-report` loads the LGPL DLL (mpv v0.42.0-225, FFmpeg N-129222).
- The endpoint probe gives these real answers: the Realtek USB S/PDIF output accepts AC-3
  and DTS only; THX Spatial takes 8-channel PCM; ordinary endpoints take 2-channel PCM up
  to 192 kHz exclusive.

That box had no logged-on user and no HDMI sink, so the following still need an interactive
desktop, an HDR display and an HDMI receiver:

1. Install the build, sign in to Ether and play an HDR10 film windowed. The card should
   show HDR10 → SDR or HDR10 (depending on the Windows HDR setting).
2. Press F11. The monitor should switch to 23.976 Hz (card: frame-rate "matched") and turn
   HDR on. Leave fullscreen: both return to what they were.
3. Play Dolby Vision Profile 5 (for example Jellyfin's "Test Jellyfin 1080p DV P5"). Colours
   must be natural, not green and purple. The card should read Dolby Vision 5 → HDR10
   (reshaped).
4. With an HDMI AVR, play TrueHD Atmos. The receiver should show Dolby Atmos/TrueHD; the
   card should read passthrough, MAT, Atmos. Then E-AC-3 JOC (receiver: Dolby Atmos),
   DTS-HD MA and DTS:X (receiver: DTS-HD MA / DTS:X).
5. Set `"exclusive": true` and play a 24/96 FLAC. The receiver or DAC should show 96 kHz;
   the card should read exclusive, lossless, 96 kHz.
6. Run `Vela.exe --av-report r.json` with the receiver on and check that `endpoints` lists
   `truehd` and `dts-hd` for the HDMI device.
