# Vela FFmpeg audio package

`vela_audio.c` is LGPL-2.1-or-later and links only LGPL-configured FFmpeg from
commit a59498db085e3d635532397128550141ab87408a. The build refuses GPL, nonfree,
version3 or missing decoder configurations. Its memory is capped at 256 MiB.

Set EMSDK to the existing Emscripten4.0.13 SDK and run:

    bun client/player/universal/audio/ffmpeg/build.ts <served-audio-decoder-directory>

The scratch build/cache stays under ~/.scratch/tmp/vela/audio-general-build.
The distribution contains vela-audio.wasm, its manifest/hash, complete FFmpeg
and bridge source tarballs, LGPL text and VELA-AUDIO-SOURCE.txt. Keep the source
files accessible beside the module. Users may replace/relink the separately
loaded decoder; update the host's package hash when distributing a modified one.

`configuration.ts` encodes the VLA1 stream configuration. `track-configuration.ts`
reads authoritative pinned-demux metadata; it does not infer a multichannel WAVE
speaker mask from count. The decoded frame's layout still outranks declaration.
ALAC's Matroska 24-byte config is wrapped in its required 36-byte atom; the MP4
hook preserves the actual alac box. WMA's validated WAVEFORMATEX is split into
context fields and decoder extradata. Vorbis receives original Xiph headers.

`transformUpstreamAudio(path, source)` is applied by the host's bundler onLoad.
It returns null for unrelated files and refuses changed upstream anchors.
Rebundle CustomDecode.worker.js and CustomAudioDecode.worker.js with the hook.
Resolve mediabunny to its src/index.ts so its ALAC box reader is transformed.
Copy these hook sources alongside the upstream source distribution: the
isobmff-demuxer.ts change modifies MPL-2.0 Mediabunny, while the engine worker
and policy changes modify MIT WebGPU Player. The original upstream files stay
pristine, and no Exact source is touched.

The package declares the option name velaConfiguration as a host/worker protocol
marker. It is not a mutable runtime option: the config envelope is provided via
configure before packets. Stock TrueHD/DTS/E-AC-3 packages never receive it.

codecs.json lists compiled decoder families, not an all-containers qualification
claim. A demuxer still needs to expose packet boundaries, private headers and
valid timing. Unknown channel masks fail rather than silently playing a guessed
speaker mapping. AC-3, E-AC-3, DTS and TrueHD keep their specialized packages.
