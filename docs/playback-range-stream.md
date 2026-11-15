# Original-file forward range acquisition

The cold-start failure was transport pacing, not an eight-credit native decoder
stall. A bounded Inception capture (`ZPTOJIOQ`, runtime `f68fb2034387da9e`)
showed native held inputs between zero and three, decodeQueueSize zero, six
preroll outputs, and an empty encoded queue. Validated source bytes grew by only
about 512 KiB/s. Ether had no slow responses or outstanding waits during the
last 6.4 seconds before the first-frame timeout. The reader fetched 256-KiB
pages serially as small block reads arrived; each paid roughly 400 ms to first
byte. Three allowed requests did not help when only one page was requested.

A generated Main10 x265 B-pyramid fixture (eight B frames, long GOP) also failed
to reproduce a native-credit deadlock: first output at 84.2 ms, held eight,
decodeQueueSize three; all 48 accepted inputs produced output by 110 ms. No
native credit policy was changed for this repair.

## Transport change

Metadata and index reads retain small random ranges. Once demux identifies a
media run, the shared reader acquires disjoint streamed ranges of up to 64 MiB
and publishes each 256-KiB cache page as its bytes arrive. Cached metadata
islands split requests without fetching the same completed page again. Audio,
video and embedded subtitle reads share this cache and pending-page ownership.

Read-ahead targets five seconds from actual container duration and file size,
clamped to 8–64 MiB. The LRU cache scales to twice that reserve, bounded at
32–128 MiB. Network concurrency remains three. The response reader pauses at
its reserve rather than allocating a whole response. Seek epochs cancel forward
responses immediately and preserve completed pages; stale completions cannot
remove a new epoch's pending page. Random reads remain separately bounded.

Every response still requires the exact 206 range, pinned total length and
revision validators; redirects remain refused. Forward retries resume at the
first unpublished page. A partial page may be retransmitted after a failed
response, but completed pages are not deliberately reacquired. Ten-second
inactivity deadlines exclude intentional backpressure. The cache bound means
arbitrarily distant revisits can require a new acquisition; it is not an
unbounded whole-file cache.

## Local measurements

One generated 46,971,023-byte, 8.01-second MKV: 3840×2160 HEVC Main10, PQ/BT2020,
DTS-core 5.1. This is not Inception or DTS-HD MA. A local server delayed every
range's first byte by 400 ms and capped aggregate response bodies at the stated
rate. Fresh headed Chrome profiles blocked service workers and HTTP cache.
Scalar request logs and the reader's bounded page bitmap measured acquisitions.

The sequential case consumed 16 MiB in 4-KiB calls, after a metadata page:

| Reader / aggregate cap | Total time | Goodput including first byte | HTTP requests | Repeated completed pages |
| --- | ---: | ---: | ---: | ---: |
| Before / 65 Mbps | 27.386 s | 4.90 Mbps | 65 | 0 |
| Streamed / 65 Mbps | 2.463 s | 54.50 Mbps | 2 | 0 |
| Streamed / 200 Mbps | 1.074 s | 125.00 Mbps | 2 | 0 |

All three acquired the same 17,039,360 validated bytes. First page latency
stayed 413–431 ms. The 65-Mbps case approaches its body cap after subtracting
the initial wait; that cap cannot supply 1.5 times a 65-Mbps title. At 200 Mbps,
the first wall-clock second delivered 117.44 Mbps, exceeding the 97.5-Mbps
headroom target. The measured cache limit was 58,640,480 bytes.

Actual core playback at position zero, same fixture and throttling:

| Metric | Before / 65 Mbps | Streamed / 65 Mbps | Streamed / 200 Mbps |
| --- | ---: | ---: | ---: |
| First GPU presentation | 1.524 s | 1.572 s | 1.461 s |
| Playable / audio-clock release | Failed reserve | 3.358 s | 2.052 s |
| Adaptive reserve target | 1.8 s | 1.8 s | 1.8 s |
| Accepted reserve at release | 0.500 s at failure | 2.000 s | 1.958 s |
| Queued PCM frames at release | 26,000 at failure | 96,000 | 96,000 |
| Added drops / underruns in one playing second | No playable interval | 0 / 0 | 0 / 0 |

The new reader required four disjoint HTTP requests for actual playback
(metadata islands plus the long media run). Repeated completed pages remained
zero. First presentation used 1,572,864 validated bytes at 65 Mbps. A screenshot
before disposal showed the generated PQ steps and grain through the real GPU
presenter. The short playing interval establishes startup behavior, not sustained
real-title parity or lip-sync.

A partially warm seek during an active 65-Mbps response cancelled that response,
presented exactly 4.500000 s after 1.129 s, and became playable after 3.133 s.
It filled 2.000007 s of PCM before clock release, with zero added drops or
underruns and zero repeated completed pages in epoch two. This is not a cold
network seek: completed initial pages were reused.

The coherent standalone player TypeScript check and matching core asset build
passed. All fixture browsers, profiles, encoders and servers were closed. Private
scalar evidence is under `client/.exact/range-stream/`; it is regenerable scratch,
not a committed test harness. Runtime `4eb2a47d73296048` awaits a bounded real-app
startup confirmation, then alternating cold lab pairs. Production remains the
qualified wrapper. The signed 0.1.42 / Ether 0.3.13 integration baseline replaces
the earlier lab.33 baseline for those new pairs.

## Cold pair 2A and foreground ownership

The first new core-first half on signed 0.1.42 / Ether 0.3.13 integration
`84a5c9482` failed before a seek or sustained sample. Vela
`VTBUH2Y23MFCVJB7CATT2YUUKD`: plan 2.581 s, first image 9.144 s,
reserve failure 12.321 s with only 0.667 s / 32,000 PCM frames against 1.8 s.
Ether delivered 17.2 MB in 10.1 s, with one 1.08-second slow range and no
outstanding source waits in the final 7.6 seconds. The failure is not erased by
the position-zero local proof. Stop/revoke returned 200, mounted players zero,
Chrome/profile closed; Ether unpinned and confirmed zero sessions/FFmpeg.
Neither the wrapper half nor pair 3 ran.

A generated 72.09-second copy of the same 4K fixture starts at 52.5 s, but a
resume at 48.08 s reproduces a first-frame deadline. Its video keyframe is at
48.06 s; the audio lookup's 100-ms lookback selects the previous cue at 40.05 s.
An audio range beginning at byte 234,849,300 owns future pages including the
video demand at byte 281,819,446. A promise for a prefetched page must not force
foreground decode to wait through an unrelated earlier GOP.

Foreground reads now split a planned range and transfer its pending promises,
cancel the old response, and release its network slot. A random read outside
all planned ranges can preempt a background request too. Completed cache pages
remain shared. Cancellation can discard an incomplete page or transport-buffered
bytes; zero repeated completed pages is the measured property, not a claim that
HTTP cancellation prevents every duplicate wire byte. Metadata lookups do not
own arbitrary distant forward acquisition.

Reader acquisition state is scalar-only: source epoch, request/byte counts,
network concurrency, cache bytes/limit, anchor, demand, reserve, active run
cursors and twelve latest read spans. Failure messages retain compact `io`
arrays before teardown: `counts=[requests,bytes,active,cacheBytes]`,
`cursor=[anchor,demand,ahead]`, and up to two runs of
`[next,end,demand,pendingPages,requestActive,paused]`. The existing host redaction
and message bound still apply. No URL, header, source identifier or content is
stored in this state.

This brings the boundary fixture's first image to 1.844 s but does not yet make
it playable. The source-complete build adapter gates streaming audio on
`DefaultDuration`; this DTS file omits it. Consequently its audio still takes
the library whole-cluster path, and the new common-cluster/header-only lookup is
not admitted. It expires with `InputDisposedError` after the eight-second audio
operation. The TypeScript/build pass does not qualify this candidate.

Next admission work must infer absent block durations from the following block
on the same track, retain one-block lookahead, and timestamp laces correctly.
Dropping the guard without that work would produce zero-duration laces. No
additional lab capture is justified before that local proof succeeds. Production
remains the wrapper; the unqualified partial repair is committed for review.

## Missing-DefaultDuration audio admission

The pinned codec parsers are now passed through the existing source-complete
build adaptation. Vela does not modify the vendor checkout or import its entire
implementation into the standalone type-check. DTS (including its core/HD
frame parser), AC3, EAC3 and AAC can use streaming acquisition without
`DefaultDuration`. Other missing-duration codecs retain the library path until
their final-frame timing can be established; this is not universal audio parity.

A compressed block is retained until the next same-track block header supplies
its duration. Only that header is read ahead. Codec frame sizes/sample rates
cross-check the span; laces split evenly across it on the container tick grid.
A gap is not stretched into sound: the preceding block and the EOF block use
the codec frame duration. Overlapping or contradictory timing fails explicitly.
Audio target lookup scans timestamps and materializes only its selected block.
Independent audio may start at the next complete frame in the shared video
cluster; its real timestamp is preserved. A larger gap, codec preroll or a
dependent packet still requests earlier indexed history.

Generated DTS lace proof: 44.1 kHz, 512 samples/frame, `DefaultDuration=null`,
three blocks with 3 / 3 / 2 fixed-size laces and a deliberate gap before the last.
All eight packets used `Audio packet acquisition: streaming`. Their timestamps
were exactly `[0,11610,23220,34830,46440,58050,100000,111610]` microseconds, each
11,610 microseconds long (the one-microsecond container grid). Thus the second
block stops at 69,660 microseconds rather than stretching to the 100,000-
microsecond next block, and the final block has its codec-derived duration.
One 18,056-byte source acquisition, zero repeated completed pages.

The same 72.09-second 4K fixture, cold resume at 48.08 s, 400-ms first byte for
every request and 65-Mbps aggregate body limit:

| Outcome | Before admission | With frame-span admission |
| --- | ---: | ---: |
| First image | Eight-second deadline | 2.154 s |
| Playable | Failed | 4.275 s |
| PCM reserve at release | Zero in the intermediate library path | 1.916672 s / 92,000 frames |
| Added drops / underruns in one playing second | No playable interval | 0 / 0 |
| Repeated completed pages | 0 | 0 |

First presentation acquired 1,729,015 validated bytes. The actual GPU picture
was inspected before disposal. The PCM reserve held the clock for 2.121 s;
existing startup bounds and output credit limits were unchanged. Eleven HTTP
requests include split/cancelled forward bodies. Completed pages are reused,
but cancelled transport bytes can be retransmitted; this remains distinct from
zero duplicate wire bytes. These are local correctness and short-start results,
not eight-minute real-title qualification or a lip-sync claim.

Standalone TypeScript and matching core asset assembly passed, key
`cfa2b02dbd43a214`. Every own local Chrome/profile and fixture server closed.
Next is one bounded real-app capture under 25 seconds; the alternating lab
pairs remain uncompleted and production remains the wrapper.
