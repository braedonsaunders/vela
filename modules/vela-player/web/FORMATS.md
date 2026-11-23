# Web player formats

What the browser player (`engine/core`, "vela-core") plays from an original file, what it
reports to the server, and the limits a browser sets. Results come from the format matrix
(`mock-server/scripts/make-format-matrix.ts`, mock README "Format matrix") played through the
app, plus the lab's live TV and a real original. Live TV and transcodes arrive as HLS and go
through the same decoders. Anything marked unverified has not been played.

## Pipeline

Video packets go to WebCodecs `VideoDecoder` with hardware acceleration first. If that refuses
the exact configuration, H.264, VP8/9 and AV1 try WebCodecs in software, and every codec with a
WebGPU decoder package (HEVC, AV1, MPEG-1/2, MPEG-4 Part 2/H.263/MS-MPEG4, VC-1/WMV3) tries the
package, which decodes on the GPU. Frames are presented on a WebGPU canvas that converts colour,
tone-maps HDR and deinterlaces package-decoded fields.

Audio packets go to WebCodecs `AudioDecoder` where the browser accepts the configuration, and
otherwise to a separately loaded, hash-pinned LGPL WASM package: FFmpeg `truehd`/`mlp`,
`eac3`/`ac3`, libdcadec `dts`, or the general FFmpeg build (FLAC, ALAC, Vorbis, Opus, MP1/2/3,
PCM, WMA and others). Decoded PCM is mixed in a worker and played by an AudioWorklet.

## Format matrix

Headless Chrome 157 and Playwright WebKit 26.5 (the engine Safari 26 uses, not Safari itself)
on an M4 Pro, 25 s of each 30 s original through the app on the mock server.

| Original | Chrome 157 | WebKit 26.5 |
| --- | --- | --- |
| H.264 High + AAC (MP4) | WebCodecs HW | WebCodecs HW |
| HEVC Main10 HDR10 / HLG (MKV, MP4) + E-AC-3, AC-3 5.1 | WebCodecs HW, external HDR route, tone-mapped | WebGPU HEVC package, tone-mapped |
| HEVC 4K HDR10 | WebCodecs HW | WebGPU HEVC package |
| Dolby Vision 8.1 (MKV, `dvh1` MP4), 8.4 | HDR10 / HLG base layer | HDR10 / HLG base layer (package) |
| Dolby Vision 7 (server record over HDR10) | base layer, EL/RPU stripped | not run |
| Dolby Vision 5 | refused to the server fallback | refused |
| AV1 8-bit (MP4) | WebCodecs HW | WebCodecs HW |
| AV1 10-bit HDR10 + Opus 5.1 | WebCodecs HW, external AV1 HDR route | refused to the server fallback |
| VP9 profile 0 + Vorbis (WebM) | WebCodecs | WebCodecs HW |
| VP9 profile 2 HDR10 | falls back (no validated route) | falls back |
| MPEG-2 720p, MPEG-2 480i (deinterlaced) | WebGPU MPEG-2 package | falls back (shader compile error) |
| MPEG-4 Part 2, DivX 3 (VfW) | WebGPU MPEG-4 package | WebGPU MPEG-4 package |
| TrueHD 5.1, DTS 5.1, E-AC-3 5.1 | WASM FFmpeg / libdcadec | WASM |
| FLAC 7.1 96 kHz, FLAC 2.0 192 kHz, Opus 7.1 | WebCodecs | WASM FFmpeg |
| ALAC 24/96 (MP4) | WASM FFmpeg | WASM FFmpeg |
| PCM 7.1 in MOV | refused: no readable speaker positions | refused |
| VobSub (MKV, FFmpeg FATE sample) | drawn, positioned and scaled | drawn |

Each playing row played 23-25 s of the 25 s window with no recovery; dropped frames were 0 in
Chrome and at most 17 of about 570 in headless WebKit. The lab's live channel (H.264/AAC
fMP4 HLS) and a real original (H.264 1080p24 with TrueHD 7.1 at 96 kHz) each played 55-79 s
with no engine recovery in both browsers, 0-1 dropped frames.

Channel mapping was checked with an 8-channel output: a tap on the worklet heard each source
channel's own tone (FL 400 Hz, FR 500, FC 630, LFE 50, BL 800, BR 1000, SL 1250, SR 1600) on
exactly one output, in Web Audio 5.1 order (L R C LFE SL SR) or WAVE 7.1 order, for FLAC 7.1,
Opus 7.1 (Vorbis order remapped), E-AC-3, DTS, TrueHD and AC-3 5.1. A stereo device heard
L = FL + FC + BL + SL and R = FR + FC + BR + SR (the folded channels 3 dB down, LFE dropped);
a 5.1 device heard 7.1's back and side pairs folded together.

## Browser limits

- **No bitstream output.** Web Audio carries PCM only; no browser has an IEC 61937, Dolby MAT
  or passthrough route. Dolby TrueHD, DTS-HD MA, AC-3 and E-AC-3 are decoded in the page.
  TrueHD and FLAC/ALAC/PCM decode losslessly; DTS-HD MA decodes losslessly when the stream
  carries its XLL extension (libdcadec), which a fixture cannot exercise (FFmpeg encodes DTS
  core only).
- **Atmos and DTS:X objects.** Without a bitstream the receiver never sees objects. A TrueHD
  Atmos stream's 7.1 presentation and an E-AC-3 JOC stream's 5.1 core are complete mixes of the
  programme with heights folded in, and those play; the info card says Atmos when the decoder
  reports objects. An HDMI LPCM link carries at most eight channels, so a browser never exposes
  a height layout over HDMI, and the engine does not render to one.
- **Channels.** Output follows `AudioContext.destination.maxChannelCount`: 7.1 needs a device that
  exposes eight channels (macOS: an HDMI receiver set to 7.1 in Audio MIDI Setup; Windows: the
  speaker configuration). Fewer channels fold with the standard downmix above and a lookahead
  limiter.
- **Sample rate.** The engine's AudioContext runs at 48 kHz; 88.2 to 192 kHz sources decode at
  their rate and are resampled. The OS mixer sits after the browser, so playback is never
  bit-perfect or exclusive.
- **Display mode.** A page cannot change the display's refresh rate or dynamic range, so frame
  rate and range matching are unsupported. Frames are paced to the display's refresh.
- **Dolby Vision.** No browser exposes a Dolby Vision display path or applies an RPU. Profile 8.1
  plays its HDR10 base layer, 8.4 its HLG base and 8.2 its SDR base (AV1 10.x likewise), and the
  info card says so. Profile 5 has no compatible base layer and is refused, so the server's
  fallback plays rather than wrong colours. Profile 7 (UHD Blu-ray) plays its HDR10 base layer:
  the enhancement layer and RPU are stripped from every access unit before decode.
- **HDR.** HDR10 and HLG are tone-mapped to SDR on the canvas. HDR output to an HDR display is
  not enabled yet, so the client lists no `hdr` ranges. In Chromium, HEVC and AV1 HDR present
  through upstream's validated external route on hardware frames; WebKit decodes HEVC HDR on the
  WebGPU package instead. VP9 profile 2 HDR has no validated route and falls back.
- **Subtitles.** SRT, WebVTT, ASS/SSA (libass via JASSUB), PGS, VobSub and tx3g are drawn in the
  page, with a delay setting for all of them. DVB subtitles are not decoded yet.
- **Decoder packages in WebKit.** WebKit's WGSL compiler rejects the MPEG-2 package's shaders,
  and its AV1 package decode froze the picture, so those packages run only in Chromium and WebKit
  falls back to the server for them (including AV1 HDR, whose native frames have no validated
  route there). MPEG-1/2, MPEG-4 Part 2 and MS-MPEG4 are offered to the server only in Chromium.
- **Containers.** The core demuxes MKV, WebM, MP4 and MOV. MPEG-TS/M2TS, AVI and disc images
  are left to the server. Multichannel PCM whose container gives no speaker positions (MOV
  without a readable `chan`, Matroska `A_PCM`) is refused rather than guessed.

## Server capabilities

`capabilities.ts` reports `originalPlayback` with the decoders that passed the matrix: H.264 and
HEVC; AV1 and VP9 where a hardware decoder takes 4K; MPEG-1/2, MPEG-4 Part 2 and MS-MPEG4 v3 in
Chromium. It reports `audioOutput` with `passthrough: []`, `immersive: []`, `maxChannels` from the
output device (at most 8), `maxSampleRate: 48000` and `lossless: true`.

## Needs real hardware or media

- A receiver over HDMI exposing 7.1 to the browser: confirm each speaker with a 7.1 channel-ID
  clip and that 5.1 sources use the side pair.
- Real TrueHD Atmos, E-AC-3 JOC, DTS-HD MA and DTS:X titles: the info card should say Atmos for
  the Dolby ones, and the DTS-HD MA title should play its XLL losslessly (libdcadec).
- Real Dolby Vision 5 and 7 titles: 5 must fall back to the server; 7 (MEL and FEL) must play
  its base layer with no artefacts from the stripped enhancement layer.
- An HDR display, before HDR output is enabled.
