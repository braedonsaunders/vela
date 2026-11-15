# Cold-path trace before scheduling changes

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
Inception gap to these local timings. No such change is included in this report.
