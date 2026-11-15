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
   `audioOutputFactory`. Its WASM kernels load from the separately built
   `libraries/audio-output-stage/audio-output-stage.wasm`; if that load fails,
   upstream uses JavaScript reference kernels for the resampler and limiter. It owns the bounded PCM worklet, backpressure, output timestamp
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
FLAC/PCM fixtures are encoded 7.1. ALAC was subsequently corrected to
5.1 because this encoder silently converts standard 7.1 to 6.1(back); ffmpeg cannot encode DTS-HD MA
or Atmos metadata. The other package support claims above describe upstream
capabilities, not local qualification of DTS-HD MA, JOC or Atmos assets.

Generate with `bun mock-server/scripts/make-audio-media.ts`. Fixtures live under
`~/.scratch/tmp/vela/media-audio/`, with sequential channel tones, then simultaneous
channels. A valid mock session media base serves `audio/<fixture-name>.mkv` with
byte ranges. Local handler check returned 206, bytes 0-15/1186771, 16-byte body
for the initial TrueHD sample. Paths and traversal are allowlisted; ordinary
session ownership/token/expiry checks still run before the fixture handler.

## General WASM fallback milestone (2026-11-14)

The playback lead installed the pinned Emscripten 4.0.13 toolchain in his scratch
worktree, built audio-output-stage.wasm and libdovi, and assembled engine assets
(key 91f8cfddc70b7353). The audio worker reused that SDK; no duplicate install.

`ffmpeg/build.ts` builds **vela-audio.wasm**, 1,546,896 bytes, SHA-256
`9ed0aa482117fadc992a914e29560244bb69c9d23ccb1a0260755db8270fe23d`.
It contains 46 decoder families from the same pinned LGPL FFmpeg, including ALAC,
Vorbis, MP1/MP2/MP3, AAC, Opus, FLAC, WMA families, integer/float/G.711 PCM,
ADPCM, and additional lossless/legacy formats. `ffmpeg/codecs.json` is the exact
compiled list. This describes module contents, not a claim about every container.
GPL, nonfree and version-3 code are explicitly disabled and checked after configure.
Decoder linear memory is bounded to 256 MiB. All code remains separately loaded.

Run the stock installer with `--general` and EMSDK set to the pinned SDK to build
the generic package too. Distribution includes exact FFmpeg source archive,
vela-audio-source.tar.gz, LGPL text, VELA-AUDIO-SOURCE.txt and a generated manifest.
Matching source and licence files must ship beside the WASM file. `--general`
is an actual build, not a download from a nonexistent published Vela release.

`prepareAudioOptions(..., nightMode, forceSoftware)` normally retains native
WebCodecs/Mediabunny for common formats. ALAC/MP2/WMA select the general module;
`forceSoftware=true` selects it after a native decode failure. The caller still
owns re-prime/cancellation at the audio clock, and must advance to Ether if WASM
fails. Native decoder support is measured by the lead's exact-config probe.

Vela also enables the upstream linked limiter on stereo passthrough, since
floating-point PCM may exceed full scale even without a downmix.

The module consumes a VLA1 envelope with demux sample rate, count, explicit speaker
mask, coded bits, block alignment, bitrate and original private bytes. Codec names
in package manifests use hyphens per the upstream grammar; FFmpeg IDs use underscores.
`transformUpstreamAudio(path,source)` applies checked build-time hooks to the
worker/policy and preserves MP4 ALAC atoms in the MPL Mediabunny fork. Only packages
with the velaConfiguration marker receive this envelope. Stock TrueHD/DTS/E-AC-3
remain unchanged. Both modified worker bundles compiled with esbuild against the
pinned sources. Vendor files remain pristine; the source offer includes the hooks.

A Chrome drive used the real module and original ffprobe-extracted packets/private
bytes, including negative codec-priming timestamps. Each decoder was drained.

| Fixture | Output frames | Layout observed |
| --- | ---: | --- |
| ALAC Matroska, 10s | 480,000 | 6 channels, mask 0x3f |
| ALAC MP4, 2s | 96,000 | Stereo |
| FLAC, 10s | 480,000 | 8 channels, mask 0x63f |
| PCM s24le, 10s, explicit fixture speaker mask | 480,000 | 8 channels, mask 0x63f |
| Vorbis, 2s | 96,256 | Stereo |
| Opus, 2s | 96,840 | Stereo |
| MP2, 2s | 96,768 | Stereo |
| WMA v2, 2s | 94,208 | Stereo |
| AAC, 2s | 97,280 | Stereo |
| PCM float64, 2s | 96,000 | Stereo |

Compressed counts include codec priming/padding; they are not proof that container
trim metadata is integrated. Unknown multichannel PCM masks were deliberately
refused; explicit fixture-source 7.1 metadata then decoded correctly. No mask
was guessed from eight channels. The original scratch alac-7.1 filename was also
found to hold seven channels (encoder conversion); the generator now uses ALAC
5.1. Neither obsolete filename is valid surround qualification evidence.

The decoded ALAC 5.1 output then passed through the **built WASM output stage**,
standard Lo/Ro and enabled peak limiter, then the real AudioWorklet/AudioContext.
The stage produced 480,000 frames without timestamp deviation, gap fill, drops or
trims. During a three-second output window, telemetry observed 139,264 consumed
frames, zero underruns, overflows, dropped/nonfinite/clipped samples, and peak
0.048 at volume 0.4. The rate was 48kHz throughout; this does not qualify a rate
conversion or severe limiter attack. No human listening pass is claimed.

Generate additional stereo fixtures with
`bun mock-server/scripts/make-audio-fallback-media.ts`. Both fixture sets are
served behind existing mock session media grants by the allowlisted audio handler.

## Ether audio-only fallback and remaining integration

Ether worker thr_5ker2zriyv implemented server branch w0312/vela-original-playback,
commit d70ab267d53b39e56df6493edfac25f5c8693c9c. Its offline FFmpeg/ffprobe check
reported exactly one AAC audio stream with absolute-title PTS near the requested
4s position, and no video. The independent job can replace/cancel audio without
changing the original video URL/source pin. This is server-worker evidence, not
an installed Vela end-to-end drive.

The canonical v0 API is POST /sessions/:id/audio-fallback with Mutation,
sourceGeneration, seekGeneration, trackId, positionSeconds and preferredCodec:aac.
Response is AudioFallbackResponse. DELETE /sessions/:id/audio-fallback/:audioId
uses Mutation. Capability features.audioFallback is advertised only when real.
The first playlist entry is relative segment 0 even at a nonzero requested
position; **schedule it at the requested absolute position**. fMP4 PTS remain
absolute and timelineOriginSeconds is 0. Do not apply the position twice.

`EtherAudioFallback` owns independent audio jobs, serializes POSTs, suppresses
stale responses, and DELETEs old/late jobs. Authenticated EtherAdapter methods own
network credentials. Optional AbortSignal support bounds requests and aborts
one shared-token-refresh waiter without canceling rotation for other callers.
The lead requested that the external AAC/native-audio clock bridge be integrated
after the first original-file custom runtime works; no parallel clock API was
introduced. Until that bridge and recovery wiring are active, this is **not** a
claim that audio-only recovery is working in the installed native view.

Remaining qualification: full native-view hookup, real 7.1 physical mapping,
DTS-HD MA and Atmos/JOC vectors, rate conversion, long-run drift/lip-sync,
track-switch listening, native → generic WASM → Ether audio-only runtime recovery,
and container-specific priming/trimming. This Mac exposes a stereo physical sink.

The lab HTTPS page loaded without a DNS rebinding problem. Capability-only probe
at `https://192-168-68-65.9cf6a8a376b9403baf1de133251c4c46.plex.direct:32550`
returned isSecureContext=true, a WebGPU adapter, AudioDecoder, AudioWorklet and
maxChannelCount=2. No lab media session or stream was opened.

## Admission and demux integration follow-up

The initial browser decode figures above did not exercise the full controller's
eligibility gate. The lead identified that distinction before advertising the
family coverage. The build-time hook now also extends these pinned host gates:

- ALAC / MP1 / MP2 are package codecs and have metadata aliases.
- A missing native capability entry is treated as unsupported, avoiding an
  undefined-property error and requiring an actually offered decoder package.
- Generic package PCM names map underscores to the manifest's required hyphens.
- Container admission is narrow: ALAC in MP4/Matroska, MP1/MP2 in Matroska;
  existing WMA and PCM container rules remain. The 46 compiled codec families
  are not blanket-added to every container whitelist.

The host eligibility bundle and both worker bundles compile with these hooks.
A separate source integration drive used the **actual pinned Mediabunny demuxer**,
its packet reader, the VLA1 metadata helper and the real general decoder:

| Container route | Frames | Private metadata result |
| --- | ---: | --- |
| ALAC Matroska | 480,000 | A_ALAC raw private bytes preserved; 5.1 mask 0x3f |
| ALAC MP4 | 96,000 | Actual alac atom preserved; stereo |
| MP2 Matroska | 96,768 | A_MPEG/L2 codec-less packets accepted; stereo |
| WMA v2 ASF | 94,208 | Actual WAVEFORMATEX split to context/extradata; stereo |

This establishes demux/private-byte wiring for these routes. Full audiovisual
controller/native-view qualification remains with the playback lead.

The pinned upstream Apache-2.0 TrueHD channel-bed reference fba_atmos_cbi.mlp
(SHA-256 4bb63a8e0e0b2ae86d4dd58a55ace5ec78fd9ff0ceb514c601e0f413ac25b53c)
also decoded through the real truehd.wasm: 136 access units, 5,440 frames, eight
planes, mask 0x63f, nonzero sample peak 0.16704595. This short 113ms reference
qualifies the decoder's 7.1 Atmos channel-bed presentation, not physical channel
mapping or long-run synchronization. Generate/remux it with
`bun mock-server/scripts/make-audio-reference-media.ts`; it verifies the source
hash and preserves the adjacent Apache licence/provenance. The session-granted
mock resource is `audio/truehd-bed-7.1.mkv`.

## Ether segment feeder and MSE timestamp gate

`feedEtherAudio(descriptor, requestedPosition, existingBackend, generation, signal)`
feeds the existing OwnedNativeMediaAudioBackendPort. It creates no clock or media
source of its own. Its owner starts the backend, controls playback/gain, and reads
that backend's qualified clock. It fetches one <=2 MiB fragment at a time, delegates
backpressure to the backend, rejects >2s fragments, bounds/retries network reads,
and anchors relative playlist segment 0 at the absolute requested position.

Prepared decoder assets can be installed without recompiling:

    bun client/player/universal/audio/install-packages.ts <served-dir> --from=<prepared-dir>

That mode verifies all four module hashes and requires matching source archives,
licences and offers. The audio worker's prepared directory is
`~/.scratch/tmp/vela/audio-packages/`; it is scratch, not a durable release store.

Ether fragment-bound fix e036a0c94 uses 1.536s AAC fragments with bounded folded
tails and TARGETDURATION 2. Its worker measured all fragment spans <=2s and sizes
<2 MiB. This resolved the existing native backend's fragment limits.

A subsequent local Chrome MSE drive caught a **separate timeline defect** in the
representative FFmpeg muxing: FFprobe reported first audio PTS 3.978667 for a 4s
start, but the actual first tfdt was 0. The init carried a two-entry elst with an
empty edit for the offset. Chrome MSE ignored that lead-in, producing a zero-based
buffer. A requested 4s start reached the 4.032s audio end; a requested 6s replacement
never qualified its clock. Old-generation stop correctly returned false after the
new generation started, but this was **not** a timeline/playback pass.

`use_editlist=0` alone removed elst but left tfdt at zero, so it was insufficient.
Ether's coordinator kept audioFallback unadvertised and assigned a mux/real-MSE
fix. `assertEtherAudioTimeline` now checks the actual init/audio track/timescale,
rejects edit lists, and requires the first fragment tfdt within 125ms of the
requested title time **before any media is appended**. It does not rewrite PTS
or infer an offset from the request. A broken producer fails explicitly instead
of exposing the wrong audio master clock. Full fixed-producer/native-view
qualification remains pending.

### Fixed producer → shipping feeder/native backend pass

Ether's corrected producer uses inner MP4 muxer settings
`use_editlist=0:avoid_negative_ts=make_non_negative` with
`frag_discont+skip_sidx`. Disabling edit lists alone was insufficient: the inner
muxer's automatic timestamp policy still rebased positive starts. The explicit
make_non_negative policy preserves positive starts while avoiding uint64 wrap
from AAC's negative encoder priming at position zero.

Ether worker thr_6vb4x5qven captured actual server output at 0/4/6s. It measured no
edts, mdhd timescale 48,000 and first tfdt 0 / 190,976 / 286,976 respectively. Its
Chrome MSE check observed buffers 0..10.021333 / 3.978666..9.999999 /
5.978666..9.999999, and advancing clocks after seeks. That is the producing
worker's evidence; those bytes were then independently exercised in Vela's path.

The audio worker copied the real 4/6s captures and ran **shipping feedEtherAudio +
OwnedNativeMediaAudioBackend**, with the new init/tfdt guard, in local Chrome:

| Action | Actual observation |
| --- | --- |
| Start generation 1 at absolute 4s | Qualified audio clock advanced to 5.111089s; four media fragments appended |
| Retire 1, start generation 2 at 6s | Qualified clock advanced to 6.427438s; three media fragments appended |
| Late stop for old generation 1 | Returned false; generation 2 kept playing |
| Generation 2 end-of-title | Audio ended event at 9.999999s; zero pending appends |

This qualifies the isolated shipping feeder/backend against fixed server-produced
bytes, including nonzero starts, retirement and EOS. It does not establish full
native-view recovery with video still direct, source-switch UI, lip-sync or a
human listening pass. The dedicated browser, temporary HTTP server and owned
media work were stopped. No lab stream was opened.

## Original audio-track switch preparation

`prepareOriginalAudioSwitch` in `audio/original-track.ts` returns an actual
container ordinal, prepared audio options, optional observed source layout and
actual track facts. It does not touch a controller, video or active output. The
lead can call setAudioStreamIndex only after successful preparation, leaving old
audio intact when preparation fails.

Broker audio entries are descriptions, not admission gates. The helper first
maps the requested description to actual source order (`InputTrack.id - 1`, not
containerTrackId), then tries its described audio ordinal, then the first actual
audio track. Empty or stale inventories are accepted. Only the chosen actual
track is prepared, so unrelated unsupported tracks cannot block playback.
Codec, channel count, rate, mask and language differences produce bounded,
fixed-vocabulary `discrepancies` notes; the returned `mapping` records the route.
Actual track fields and decoder configuration determine decoder selection.
An unmatched actual track gets a local `demux-audio-<id>` identifier, which must
not be reported as a server track ID. Source masks remain nullable: an
unqualified mask is omitted so the compressed decoder can establish its layout;
unknown multichannel raw PCM positions remain unsafe and require fallback.
No speaker positions are inferred from a broker description.

With only a URL it opens the ORIGINAL through UrlSource with upstream HTTP range validation:
actual HTTP requests capped at 256 KiB, cache 8 MiB, total metadata-read budget
32 MiB, finite retries, per-read deadlines and a 30s preparation bound. A changed
resource length/ETag refuses preparation. Range-ignored whole-file fallback is
rejected, and the owned Input is always disposed before returning. No sink speaker mask
is invented. Night algorithm changes still use the controller's existing output
reconfiguration API; the upstream track-switch API omits that field.

The optional `input?: Input` borrows an already-open, validated source, allowing
the video probe and audio preparation to share its demux/cache. This path uses
the caller's common signal without adding an abort listener, creating another
source or disposing the Input on any path. The caller must keep it alive until
both operations settle, own cancellation of its reads, and bound its wait on
unabortable browser support checks. Actual audio mapping, format validation and
decoder selection are unchanged. Compressed native audio uses one exact
`AudioDecoder.isConfigSupported` check; it no longer repeats that same check via
`track.canDecode`. PCM retains its Mediabunny decodability check. The helper's
return shape is unchanged; sharing an Input does not share decoder state.

A read-only source-integration drive exercised real file bytes and the pinned
demuxer through an in-process range-response adapter (not a network/server
qualification). ALAC Matroska/MP4, MP2 Matroska and WMA v2 ASF returned ordinal 0,
actual 48kHz format and their correct software package in a runtime without
AudioDecoder. That earlier drive predates the policy of recording descriptive
mismatches rather than refusing them.
Eight metadata range requests were made, none larger than 262,144 bytes. Browser
native support, a real mid-play switch and pending-state UI remain lead-owned.

The current metadata-only check used the local synthetic HEVC/E-AC-3 fixture.
Wrong codec, channel count, rate, mask, language and inventory descriptions all
returned the actual E-AC-3 5.1(side), 48kHz track and discrepancy notes. Empty
inventories, unknown requested IDs and missing source indices/ordinals also
prepared actual audio. The selected helper type-checked and bundled. This did
not open a browser, lab stream, provider fetch or capture private source data.

## Nested-worker asset diagnosis

The playback lead's three native-view attempts produced zero frames and timed out
while serving artifacts through a Playwright page.route overlay. The focused
no-media diagnostic proved that the overlay intercepted the top-level worker but
not the nested audio worker: the child load failed and only the parent's route
handler ran. This was a qualification-environment failure, not evidence against
the decoded audio formats.

A temporary localhost:8794 server then served the lead's **real** complete
client/modules/web tree with JS/WASM/JSON/bin MIME and byte-range support, and
proxied the existing mock API/media without rewriting payloads, Range or
Content-Range. Direct checks returned worker JS 200/application/javascript,
output-stage and libdovi WASM 200/application/wasm, and a correct 206 range with
WASM magic 0061736d01000000. The lead's actual worker bootstrap and in-worker
WASM fetch/compile passed without a media source. Any further source attempt
required the parent's renewed clearance after the three-attempt limit. This
no-source proof does not itself qualify native-view playback.

The parent's renewed clearance allowed one native-view original AVC/AAC attempt
using that real same-origin asset/proxy server. The playback lead reported:
first frame 830.6ms, 192 decoded/presented frames, ended at 8.0001s, no errors,
zero late frames and worst measured frame/audio-clock lag 13.151ms. This was the
synthetic eight-second mock source. It confirms native-view custom playback with
real nested-worker assets; it does not qualify every decoder family, a human
listening/lip-sync pass, a lab stream or physical surround output.

## Vela core audio adapter

`audio/core-output.ts` implements the Vela-owned `core/types.AudioOutput`; it
imports no upstream playback controller. Construct `createCoreAudioOutput` in the
play gesture with `{libraryBaseURL, assetKey?, signal?, onClock, onFailure}`.
The base is the verified payload's `libraries/` directory. Optional forceSoftware
and nightMode select a route/processing policy, not another player.

The instance owns its AudioContext, AudioWorklet and one audio decode worker.
It reuses the pinned audio worker, downmix, limiter, resampler and time-stretcher
as components. Exact native AudioDecoder configuration is tried once, then an
installed verified package. Real codecPrivate/WAVE bytes feed the VLA1 metadata
envelope; unknown multichannel raw PCM positions remain unsafe. Decoder failure
is reported with epoch, actual track ID and stage, so core recovery can retry
software or an authorized Ether audio conversion without replacing video.
A failed native track is remembered for the instance's next configure/flush.

Input credits and the2s worklet bound apply backpressure; native PCM staging is
capped at16MiB. Raw PCM packets split on actual sample-frame boundaries. Seek
flush creates a new decoder attempt and producer channel on the same context;
late callbacks retain their old attempt and cannot advance the new epoch.
Playback primes80ms before running the worklet, with a short EOF exception.
Credit waits are cancellable and exclude paused time from their8s stall bound;
native input without PCM fails after2s of packet time or256 packets. Every
resource/probe operation has a separate finite bound. `drain` flushes true EOF
tails into the bounded queue; it does not replace the core's end scheduling.

`onClock` reports physical output points using getOutputTimestamp, worklet media
and context timestamps, and the buffered end. Core MediaClock owns extrapolation
and playback intent. Pause, gain/mute,0.25–4x pitch-preserving rate and disposal
are explicit; no independent media-time animation loop is introduced.

A generated-file local Chrome measurement used the actual core RangeReader and
FileDemux. Native AAC stereo44.1kHz and forced-package E-AC-3 six-channel48kHz both
advanced the PCM output clock, paused, and sought to4s on the same audio output.
The first moving physical anchor was36.4/24.4ms after the measurement start;
the seek anchor was8.0/6.6ms after seek began. Those are audio component timings,
not whole-player first-frame timings. Steady media/performance anchor phase
spread was147/161µs, and145/169µs after seek, over these short measurement windows.
Both passes reported0 dropped frames,0 overflow and0 underflow before and after
seek, with no decoder failures. Source reads reused the same reader cache.

TypeScript and the browser bundle compiled; the bundle input list contained no
upstream CustomPlaybackController. The dedicated Chrome and owned8796 fixture
server were closed. This does not claim a human listening or A/V lip-sync pass,
all codec coverage through the new adapter, true EOF-tail qualification or the
new core's completed runtime integration. Those remain integration gates.
