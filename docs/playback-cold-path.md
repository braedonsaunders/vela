# Cold-path trace and streaming acquisition repair

Captured after the fixed-host lab.33 pair. No runtime, queue limit, byte-cache
policy or demux algorithm was changed. Private JavaScript wrappers observed the
existing objects; both immutable payloads remained byte-for-byte unchanged.
All local browsers, temporary profiles, encoders and servers were closed.

## Method

A local range server supplied generated HEVC Main10/PQ plus DTS-core 5.1 at a
4.5-second resume point. Media delivery had an aggregate 65-Mbps cap. Separate
runs distinguished a one-time 800-ms cold-source ramp from an 800-ms delay on
*every* range; these are materially different models. Assets were local and
unthrottled. Each backend had a fresh headed Chrome profile, blocked service
workers and disabled HTTP cache. Driver/GPU caches outside the profile were not
reset. Scalars recorded HTTP intervals, reader calls, queued/active demux work,
Matroska methods, decoder configuration/input/output and actual presentation.
No lab media was fetched or captured for these fixtures.

The small fixture was 640x360, 1,580,051 bytes, 8.01 s. The larger fixture was
3840x2160 Main10, 46,971,023 bytes, 8.01 s (46.9 Mbps), generated with
VideoToolbox from the existing actual-PQ synthetic pattern, with grain and a
long GOP, then muxed with generated DTS-core audio. It is not DTS-HD MA, the
Inception bitstream, or an exact reproduction of its keyframe/index structure.

## One-time cold ramp, small fixture

All values are seconds after local plan admission.

| Event | Core | Wrapper |
| --- | --- | --- |
| Metadata starts | 0.209 | 0.301 |
| Metadata ready | 1.136 | 1.230 |
| Audio preparation ready | In parallel with video configure | 1.361 |
| Decoder/presenter configure ready | 1.212 | 1.517 |
| First decoded callback / observation | 1.218 callback | 1.791 observation |
| First presented frame | 1.247 | 1.796 |
| Open/playable ready | 1.325 | 1.790 |

The core read its first cluster during metadata (1.040–1.135), then fetched
Cues only after configuration (1.213–1.214). The wrapper repeated header reads
in its independent audio preparation; its worker began its larger media GET at
1.540 s. This fixture does **not** reproduce the UHD performance ordering.

The separate 800-ms-*per-range* sensitivity trace made the ordering visible:
core metadata 0.309–2.851, configure 2.851–3.580, Cues fetch 3.584–4.384,
first decoded callback 4.390, first presentation 4.415, playable 5.297. Thus
configuration and Cues I/O were serial, costing 0.73 + 0.80 s here. The wrapper
re-read headers during audio preparation and timed out at eight seconds. That
model charges cached/repeated reads the same network delay as cold reads; it is
not a faithful Ether/debrid-cache model and is not a lab parity result.

## One-time cold ramp, 4K long-GOP fixture

| Core event | Start | End |
| --- | --- | --- |
| Module/assets and source setup | 0 | Metadata at 0.237 |
| First HTTP range | 0.241 | First bytes about 1.04 |
| Matroska segment/seek-head handling | 1.070 | 1.070 |
| First cluster read during metadata | 1.071 | 1.714 |
| Metadata operation | 0.237 | 1.714 |
| Decoder and GPU presentation configure | 1.714 | 1.812 |
| Deferred Cues load | 1.813 | 1.814 |
| Initial video keyframe lookup | 1.813 | 5.104 |
| Audio lookup queued behind video | 1.813 | Starts 5.104, done 5.105 |
| First encoded video submitted | 5.104 | — |
| First decoded output | 5.151 | — |
| First presented frame | 5.854 | — |
| Buffer ready / open returns | 6.501 | — |

The metadata operation requested 5,373,162 bytes: it read a whole first cluster
before video configuration. The initial video-packet operation then requested
26,760,247 bytes across later clusters before returning the preceding keyframe
at timestamp zero. That is 3.291 s before *any* compressed video reached the
decoder, while audio waited on the same operation queue. First decoder output
followed input by 47 ms. Preroll decoding and additional reads then preceded
the target presentation. The long GOP requires real preroll; these numbers do
not imply its bytes or decode work can be omitted safely.

In this run the native eight-packet credit limit did not prevent output: the
first callback arrived while the ninth submission waited, and subsequent
packets progressed. No decoder-credit deadlock is claimed from this trace.

The wrapper reached metadata ready at 2.449, audio ready at 3.122 and configure
ready at 3.329. Its worker media GET began at 3.358, but the local eight-second
operation expired before presentation. The short long-GOP fixture plus the
server's lack of a shared origin-byte cache penalises repeated/overlapping
wrapper reads. Therefore this is not evidence that the wrapper is slower on
Inception, nor a complete reproduction of the lab's first-attempt failure.

## Findings and limits before a fix

- Confirmed serialisation: metadata's full-cluster/sample work precedes video
  configure; configuration precedes the first Cues lookup; initial video lookup
  precedes audio lookup; decoding cannot overlap the initial keyframe search.
- Cues parsing itself was about 2 ms in the 4K fixture. A huge-Cues CPU bottleneck
  is not demonstrated by it. The initial keyframe/cluster search dominated.
- The core already issued two/three page reads concurrently within a requested
  span. The problem is not simply that every HTTP range is serial.
- Neither fixture reproduces the lab's client-idle eight-second first attempt.
  Lab.33 remains the authoritative performance comparison (core first frame
  15.506 s versus wrapper 9.715 s, including core retry).

The next candidate change should overlap already-authorised index/first-cluster
work with configuration, and permit decoding from a proven preceding keyframe
while acquisition progresses. It must preserve exact target preroll, real track
identity, bounded memory/read work and epoch cancellation. A realistic shared
origin-cache/large-index profile is still needed before attributing the full
Inception gap to these local timings. The following repair addresses the measured
serial work; the lab comparison remains the parity gate.

## Streaming acquisition repair

The file demux now obtains H.264/HEVC Matroska packets from bounded block cursors
over the existing source reader. A preceding Cues entry locates the cluster;
its first usable key block reaches the decoder without acquiring every later
block in the lookup span. Lacing, header stripping and codec packet-type
classification use the pinned library components. Unsupported shapes retain
the existing library path. In particular, audio without a proven default
duration retains its duration/lacing inference during playback.

Cues bytes begin prefetching after segment metadata is read, and actual index
parsing overlaps remaining metadata. Video configure starts as soon as its
actual descriptor is ready. Independent video/audio cursors then run together;
the library's mutable parsing operations remain serial. The source reader,
cache limits, epoch cancellation, read/search deadlines and audio priming
policy are unchanged. No upstream controller or second byte cache is added.

Repeated the same 4K fixture, 4.5-second resume, aggregate 65-Mbps cap and
one-time 800-ms ramp with fresh headed profiles for each immutable payload:

| Event or counter | Before | After |
| --- | ---: | ---: |
| Metadata ready | 1.657 s | 1.084 s |
| Video configure interval | 1.657–1.978 s | 1.049–1.124 s |
| Initial video lookup begins | 1.979 s | 1.124 s |
| Initial audio lookup begins | 5.269 s | 1.124 s |
| First native encoded video input | 5.270 s | 1.186 s |
| Validated reader bytes before that input | 32,290,959 B | 1,095,823 B |
| Reader requests before that input | 124 | 7 |
| First decoded video output | 5.288 s | 1.205 s |
| First presented frame at the requested target | 5.998 s | 4.359 s |
| Open/playable resolves | 6.641 s | 6.369 s |

Both first inputs contained the same 834,627-byte keyframe. Both first presented
timestamps were exactly 4,500,000 microseconds: neither run displayed the
earlier keyframe as if it were the target. Both continued playing with zero
video drops. The byte counter counts completed, validated source-page bodies;
it excludes partial in-flight responses. It is not a count of demux caller
reads, nor a claim that no bytes were in flight at the measurement instant.
Driver/GPU caches outside the fresh profile were not reset, so configure-time
variance is not wholly attributable to this change.

Time to first encoded input fell by 4.084 s and bytes before it by 96.6%.
Target presentation improved by 1.639 s. Real long-GOP preroll and the unchanged
adaptive audio priming still cost time; the open/playable improvement is only
0.273 s. These are local results, not a claim of meeting the LAN start target
or beating the production wrapper on Inception.

The streaming AV cursor also records subtitle block ranges and actual cluster
timestamps without fetching unselected subtitle payloads. A separate generated
video-plus-PGS fixture, with no audio/full-cluster fallback, rendered 3,168
caption pixels at 1.5 s and after a paused seek to 4.5 s (119.4 ms), cleared at
7.5 s, and removed the overlay on Off. Its Cues-walk methods were made to fail
if called; none were called. The full-cluster cache was absent in this proof,
so these pixels exercised the new block stream. All local browsers, profiles
and temporary servers were closed afterward. The scoped TypeScript check and
runtime/source-offer build passed.
