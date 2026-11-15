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

## Progress-based startup, with the reserve retained

The bounded real-app `cfa2b02d` capture (`ZVPAU5A3NB6QWK7FRX74LW2OF4`) still
failed its wall-clock reserve bound: plan 2.006 s, first image 8.973 s, then only
0.875 s / 42,000 PCM frames at the failure. Its scalar history confirms both
tracks used streaming acquisition and a forward range stayed active, unpaused.
Ether independently identified supply-limited read-ahead: the RD host delivered
13.1 Mbps, and the server inferred demand from those delivered bytes, selecting
only two runs instead of sizing from the known 65.6-Mbps title. This is not a
reason for another reader-size patch. Ether's subsequent bitrate-floor fix is
separate from the client policy below.

Startup now has one progress clock, from source admission through metadata,
first presentation and PCM reserve. Incoming body bytes, encoded packet bytes,
decoded output and actual queued/submitted PCM advance it. Eight seconds with
none of that progress fails the route; 45 seconds is an unconditional admission
ceiling. A timestamp initialized to the requested position is not PCM progress.
The reserve target and output credit/memory bounds are unchanged. The audio
clock stays stopped until reserve or a real EOF tail is established.

Per-operation wall-clock demux/fragment deadlines no longer override that
startup policy while bytes flow. Logical search/packet bounds remain. HLS
requests use byte-inactivity deadlines instead of a ten-second whole-object
deadline. Startup monitoring is disposed on completion, abort or failure; normal
playback retains its existing stall handling. A moving live source does not run
its post-start frame watchdog during admission.

The core exposes the optional `startupPending` backend property. The host
lets `implementation='vela-core'` own admission while that property is true;
its eight-second original timer and generic start/position watchdog cannot
abort a flowing core start. A wrapper or older immutable core without the flag
keeps its existing policy. Thus this requires the matching host build, not just
a descriptor change on installed 0.1.42. The production default remains wrapper
`3c579f70de6e1cfe`; no wrapper payload rebuild is needed.

Local proof used the same generated 4K DTS fixture, cold 48.08-second resume,
400-ms first byte per request, but an 11-Mbps aggregate body cap:

| Metric | Wall-clock policy | Progress policy |
| --- | ---: | ---: |
| First image | 3.113 s | 3.000 s |
| Playable | Reserve failure | 11.669 s |
| Reserve at release/failure | 0.625 s / 30,000 frames | 1.916672 s / 92,000 frames |
| Reserve hold | Old bound expires | 8.668 s |
| Added drops / underruns in one playing second | No playable interval | 0 / 0 |

The new policy keeps the spinner while data arrives, rather than retrying a
healthy slow start. Eleven Mbps is below the fixture's media bitrate: the short
proof establishes priming and admission, not sustained realtime playback on
such a connection. Independent process/driver warmth makes the small first-image
difference unimportant. The final compiled counter projection uses actual PCM
submissions, not the initialized timeline origin. Own browser/profile and
fixture server closed. A matching-host real-app capture and the alternating
cold pairs are still required before any default proposal.

## Signed 0.1.43 qualification stopped for cache thrashing

The signed host hash is `70623c5d64968475d539ed59a12fa9d8e6b10c632ac50dcf15ba76909caba567`.
The raw repository-root build was `0227cfa2…01d65`: release builds run from the
staged client directory. Normalizing only the 29 anchored source-path comment
prefixes makes the entire raw host byte-equal to the signed 170,277-byte host.
Both delegation guards are present. This was independently checked against the
served bytes and packager's tar/manifest. An identity-aborted drive made no
playback request and its exact grant was revoked by the operator.

On fixed signed 0.1.43 / Ether integration `58e86491a`, core `aaa11c29` passed a
bounded cold capture: first image 7.097 s, playable 7.537 s, full 1.916667-second
PCM reserve and zero drops/underruns in two playing seconds. The following
core-first half (`GXIKBXZPSU5TYQB7H4TUVMYBKY`, Ether `3fde9b44`) reached an image
at 5.553 s, playable at 6.755 s, and cold-seek playing at 5.245 s. It accumulated
three startup underruns (75,040 output frames) and three more during the early
post-seek ramp. No additional underruns appeared through the stopped sample.

More seriously, at post-seek 151.7 s the reader reported 6,110 unique pages and
5,492 reacquisitions of completed pages, 2,768 HTTP requests and about 158.5 Mbps
validated acquisition. This was not just discarded transport bytes. The parent
stopped the half around 272 seconds; neither a wrapper half nor pair 3 ran.
There is no completed new paired qualification and no default proposal.

The owned Node driver's SIGTERM handler did not prevent Playwright's default
browser signal handler from closing Chrome before UI cleanup. The operator
stopped exactly Ether session `3fde9b44` (200), revoked only device
`31825224-5fb5-473e-a83a-196bc22f81de` (200), unpinned (204), and confirmed zero
sessions/FFmpeg. Future private drivers disable Playwright signal handling and
perform their own bounded cleanup. No unrelated browser or grant was touched.

The old policy added five seconds of bytes to a demux cursor that was itself
already several seconds ahead. Unrestricted LRU eviction then discarded future
pages or pages another track still needed, and the planner fetched them again.
The replacement maps demuxed packet byte positions to the media clock, pins the
front window and outstanding parser spans, and evicts media behind the playhead
in byte order. Its budget is five-second read-ahead (8–64 MiB) plus a bounded
40–64-MiB back-buffer, at most 128 MiB total. Static metadata has a bounded
24-MiB reserve inside that total. When protected pages occupy the budget,
acquisition waits for playhead progress instead of evicting them. Retired seek
bytes outside the replacement window can be discarded; active epoch future
pages cannot. Packet sequence numbers are treated as byte offsets only for the
explicit streaming Matroska adapter that defines them that way.

Scoped TypeScript and matching asset assembly passed (`973a2fa0aef90a31`).
The generated 608.76-second 3840×2160 HEVC Main10/PQ + DTS 5.1 MKV was served
with 400-ms first byte per HTTP range and a 65-Mbps aggregate body cap. Four
120-second playing intervals, with seeks to 240.38, 120.23 and 360.53 seconds,
completed 480.52 seconds of playback in 493.23 seconds wall time.

| Sustained local metric | Result |
| --- | ---: |
| Reacquired completed pages within each of four epochs | 0 |
| Validated unique acquisition bytes | 2,936,131,286 |
| Browser HTTP body bytes | 2,958,413,526 |
| HTTP / validated unique bytes | 1.00759 (+0.76%) |
| HTTP requests | 72 |
| Maximum cached bytes / bound | 71,159,510 / 71,262,751 |
| Dropped frames / audio underruns | 0 / 0 |
| First presented image / playable | 1.621 s / 3.286 s |
| Three seek-to-playable times | 3.170 s / 3.149 s / 3.095 s |

The PCM reserve remained at least 1.833 seconds at initial release and 1.875
seconds after each seek. This is a generated DTS-core fixture (44.1 kHz,
resampled to 48 kHz output), not DTS-HD MA or a human lip-sync qualification.
Private scalar evidence is `range-stream/pinned-long.json` beside its playing
screenshot; the owned browser/profile and fixture server are closed.

Review then found a separate full-cache seek admission cycle: clearing the
retired byte cursor before a new Cues read prevented reclamation until the first
media prefetch, which itself needed that metadata. The cursor now stays solely
for reclamation until the first new-epoch media prefetch binds the replacement
window. Matching TypeScript/asset assembly passed (`b76cabc0b114bf77`). A narrow
reader-only proof filled the 71.26-MB cache to within one page, retired the epoch,
read a new distant metadata page in 412 ms (400-ms simulated first byte), then
rebound the media window at 300 MiB. Repeated pages remained zero and capacity
stayed bounded. This final rollover adjustment has that targeted proof; the
full eight-minute AV proof above used `973a2fa0aef90a31`.

Neither local proof qualifies the real cold debrid pairs. The matching runtime
must be staged and both alternating pairs rerun before any default proposal.
Production remains the wrapper.
