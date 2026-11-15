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
