# Universal audio integration and qualification

Audio host code lives in `client/player/universal/audio/`. The playback lead owns
integration with the native view and the pinned MIT engine in
`vendor/webgpu-player` (a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2).

## Runtime integration

1. Run `bun client/player/universal/audio/install-packages.ts <served-decoder-dir>`
   during engine asset preparation. This downloads **separate**, replaceable
   truehd/dts/eac3 WASM files, LGPL texts, matching source archives and SOURCE.txt.
   Serve that directory beside the engine assets, including the source archives.
2. Construct `createAudioPackages(absoluteDecoderDirectoryURL)` once. Call
   `prepareAudioOptions(registry, {codec,channels}, actualMaximumOutputChannels,
   signal, nightMode)` for initial play and every track change. Spread its options
   into upstream play options; supply the demuxer's qualified `audioMetadataLayout`
   separately. Package load failure rejects before disrupting the old audio.
3. Use the upstream `createBrowserCustomAudioOutputFactory()` for
   `audioOutputFactory`. This needs the separately built
   `libraries/audio-output-stage/audio-output-stage.wasm` for its resampler and
   limiter. It owns the bounded PCM worklet, backpressure, output timestamp
   correction, gap handling and underflow clock. No SharedArrayBuffer is required.
   Read controller `currentTimeMicroseconds / 1e6` as the video presentation clock.
   Do not advance a wall-clock timer independently of audio during underruns.
4. `switchPreparedAudio` calls upstream `setAudioStreamIndex` at that audio-master
   time. This retains source/session identity, but the pinned upstream restarts
   **both audio and video decode generations**; it is not a video-untouched switch.
   Abort superseded package preparations before invoking a switch.
5. `VelaAudioControls` restores the existing `vela.player.volume` and
   `vela.player.muted` preferences; apply commands there when using the custom
   controller. Ambient output never reads/writes preferences. Pass its nightMode
   into initial preparation. Live dialogue changes use reconfigureAudioOutput,
   because upstream track-switch options do not carry the downmix algorithm.

Use the actual sink maximum, not a channel count inferred from the stream.
Unknown/small sinks select stereo; sufficiently wide sinks select 5.1/7.1.
Input layout remains decoder/demux authoritative. Standard Lo/Ro uses -3 dB
center/surround and omits LFE; upstream lookahead limiting contains summed peaks.
The night dialogue matrix is an optional alternative, not speech separation.

## Licensing and replaceability

Release v0.1.1 of `alchemyyy/webgpu-player-decoders`, commit
672c83e67ce2b0de0070602980f98023e0baaddd, supplies these LGPL-2.1-or-later modules:

| File | Decoder | Source |
| --- | --- | --- |
| truehd.wasm | TrueHD / MLP, including Atmos channel presentation | FFmpeg a59498db085e3d635532397128550141ab87408a + bridge |
| eac3.wasm | E-AC-3 / AC-3, JOC core bed | Same FFmpeg + bridge |
| dts.wasm | DTS core, DTS-HD HR / MA | libdcadec b93deed1a231dd6dd7e39b9fe7d2abe05aa00158 + bridge |

The installer places complete corresponding source tarballs and licence texts
next to binaries. Distributor must keep these downloadable for the applicable
LGPL source availability period. The source offer/location is SOURCE.txt, served
in that same directory. Preserve MIT KEMAR HRIR credit (Bill Gardner and Keith
Martin, MIT Media Lab, 1994). No decoder is statically linked into Vela.

`packages.ts` pins release SHA-256 hashes, checked before compile/load; the engine
loader validates manifests, imports, memory and exports. To replace/relink a
modified module, update its hash in that source file and rebuild the host; the
installer must likewise be pointed at the modified source/binary distribution.
The matching-source archives are part of distribution, not optional development
artifacts. This does not claim that dynamic loading alone satisfies the LGPL.

## Local milestone: Chrome on this Mac, 2026-11-14

No CI or test suite was added. The Contract compile returned `[]`; mock TypeScript
compile passed, and the audio adapter browser bundle compiled. The isolated drive
used the real package loader and upstream PackageSoftwareAudioDecoder, then the
upstream AudioWorkletController with decoded PCM and standard Lo/Ro downmix.

| Observation | Result |
| --- | --- |
| TrueHD decode | 480,000 frames / 10s, 48kHz, 5.1(side) |
| DTS core decode | 480,256 frames including codec padding; solo channels 0..5 correct |
| E-AC-3 / AC-3 decode | 480,768 frames including padding each; solo channels 0..5 correct |
| Worklet output, ~7s | 0 dropped, overflow, underflow, nonfinite or clipped samples |
| Clock timestamp correlation over 6.3093s | 0.0303ms difference between mapped output time delta and output performance timestamp delta |
| Physical destination | maxChannelCount=2; no physical 5.1/7.1 claim |

This is a decoder/worklet measurement and an output-path exercise; **no human
listening pass, video lip-sync measurement, or full limiter/resampler asset run**
is claimed. The clock comparison correlates browser timestamps from the same
clock; it does not measure physical speaker latency or long-run A/V drift.

The browser drive caught and fixed an unbound window.fetch call. It also caught
FFmpeg silently reducing requested TrueHD 7.1 to 5.1: this encoder supports at
most 5.1(side). The generator now calls it truehd-5.1 and verifies actual output
channel counts. Do not use the obsolete scratch truehd-7.1 filename as evidence.
FLAC/ALAC/PCM fixtures are genuinely encoded 7.1; ffmpeg cannot encode DTS-HD MA
or Atmos metadata. The other package support claims above describe upstream
capabilities, not local qualification of DTS-HD MA, JOC or Atmos assets.

Generate with `bun mock-server/scripts/make-audio-media.ts`. Fixtures live under
`~/.scratch/tmp/vela/media-audio/`, with sequential channel tones, then simultaneous
channels. A valid mock session media base serves `audio/<fixture-name>.mkv` with
byte ranges. Local handler check returned 206, bytes 0-15/1186771, 16-byte body
for the initial TrueHD sample. Paths and traversal are allowlisted; ordinary
session ownership/token/expiry checks still run before the fixture handler.

## Remaining requirements

The pinned upstream supports WebCodecs AAC/Opus/Vorbis/FLAC/MP3 and Mediabunny PCM
formats. It has **no ALAC codec admission/decoder**, and these common WebCodecs
codecs lack a general WASM fallback in this release. The route policy reports an
explicit Ether requirement when no local decoder remains; it does not create an
Ether audio transcode or claim that server capability exists. A true audio-only
Ether replacement requires the protocol/server track transport plus runtime
recovery wiring. No such request was sent. Replacing only the audio decoder after
a runtime native failure still needs playback-lead integration and qualification.

The full engine output requires building audio-output-stage.wasm; Emscripten is
not on this Mac's PATH at this milestone. Full integration, real 7.1 mapping,
DTS-HD MA, ALAC and Atmos/JOC vectors, drift, track-switch listening, and native
failure → WASM → Ether audio-only fallback remain unqualified.

The lab HTTPS page loaded without a DNS rebinding problem. Capability-only probe
at `https://192-168-68-65.9cf6a8a376b9403baf1de133251c4c46.plex.direct:32550`
returned isSecureContext=true, a WebGPU adapter, AudioDecoder, AudioWorklet and
maxChannelCount=2. No lab media session or stream was opened.
