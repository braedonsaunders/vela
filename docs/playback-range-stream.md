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

## Pinned-cache real-app pairs on signed 0.1.43

Runtime `b76cabc0b114bf77` was staged additively, with archive SHA
`aa95006c8fbc81a68c8752511a879e5089030978b012315f20b55e48e0485fff`
and payload-manifest SHA
`7951d3ec01a7b4cf88c16ab89855273fbe278a0d48b1f0e7f8636d4b0552b596`.
The installed signed host remained `70623c5d…a567`, production wrapper remained
`3c579f70de6e1cfe`, and Ether remained integration `58e86491a` throughout.
Before every half, the operator set resume to 1390.5 seconds, deleted only the
pinned Inception release's disk cache, restarted that same binary to clear RAM,
and independently verified the exact `525f3640…` pin and zero sessions. CDN-side
warmth and response timing are outside our control. A dedicated headed Chrome
context blocked service workers and disabled browser cache. The same read-only
host audit was used for both engines; only the core half's in-memory runtime
descriptor differed. There were no detail-page prewarm visits.

| Half, order | Plan | First image (post-plan) | Playable | Cold seek 900 | Startup underruns / drops | Post-seek sample |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 2A core first | 2.071 s | 7.776 s (5.705 s) | 7.850 s | 2.578 s | 0 / 0 | 480 s: 0 underruns, 0 drops, 0 buffering |
| 2B wrapper second | 2.020 s | 7.269 s (5.248 s) | 7.271 s | 3.120 s | 0 / 0 | 480 s: 0 underruns, 0 drops, 0 buffering |
| 3A wrapper first | 1.955 s | 8.048 s (6.094 s) | 8.054 s | 2.737 s | 0 / 1 | 480 s: 1 underrun (101 ms), 4 drops, 1.007 s buffering |
| 3B core second | 1.825 s | 6.175 s (4.350 s) | 7.012 s | Not attempted | 2 (285 ms) / 1 | Stopped before seek while buffering |

All four halves had zero retries and no server-HLS fallback. The driver labels
3B's stop as "Recovery before seek invalidates pair"; the recorded state is
**buffering with an empty PCM queue**, not a route recovery. Its history is empty.
The sample stopped rather than proceeding to the cold seek. The completed 3A
wrapper trace includes one buffering interval at post-seek 1.015–2.021 seconds;
an interim message saying zero stalls was corrected after reading that trace.

The cache correction is proven on the real remux: core 2A completed startup,
the cold seek and all 480 playing seconds with zero repeated completed pages,
zero underruns, zero drops and zero buffering. It issued 76 requests, validated
4,098,665,968 bytes and received 4,101,287,408 body bytes (0.064% overhead), with
15,251 unique pages and zero repeated pages in the final epoch. Ether delivered
4,119,195,120 bytes and confirmed direct original playback with zero transcodes.
This replaces the previous 5,492 repeated pages at only 152 seconds. The final
playing screenshot was inspected. Source demand now follows media consumption.

The remaining failure is the cold ramp's reserve, not duplicate acquisition.
Core 3B released the clock with 2.000 seconds of actual PCM, after holding it
807 ms; the policy target was 1.8 seconds, measured headroom 0.708 and maximum
TTFB 1.076 seconds. Five seconds later the queue was empty, position 1395.25,
with two underruns totaling 13,664 output frames. It had validated 62,434,800
bytes over 15 requests, 239 unique pages, zero repeats, and no recovery.
Ether measured 50.0-Mbps goodput over the first ten seconds against the title's
65.6-Mbps average, only 0.5 MB ahead, and fresh dials queued at 250-ms spacing.
That below-consumption ramp also appeared in wrapper 3A, whose buffer was only
1.6 MB at the early underrun. The producer-side connection/refill improvement
is a separate Ether item; changing it during these halves would invalidate the
comparison. A fixed two-second PCM reserve does not establish that the refill
has reached sustainable throughput.

Raw private evidence is `paired43e-{core,wrapper}.json` and
`paired43f-{wrapper,core}.json` under the worktree's scratch-backed client output.
All four UI stop commands returned 200/ended; all four exact browser grants were
revoked with 200; mounted players were zero; all dedicated contexts, Chrome
processes and profiles closed. The operator independently confirmed pins empty,
zero sessions and zero Ether FFmpeg processes, and released the server hold.
The architect was notified that performance tracing could resume. No reset or
additional playback was requested after 3B.

**No default switch is proposed.** Pair 2's core startup was about half a second
slower, and pair 3's core did not satisfy the zero-underrun startup condition.
The old failed pair is not retroactively qualified by this cache fix. The core
remains gated until cold-ramp admission is reliable and the requested repeated
parity evidence is clean. Production, catalog, service worker and defaults are
unchanged.

## Short capture after Ether's dial-spacing change

Ether then changed to integration `977550aa9`, keeping signed 0.1.43 and core
`b76cabc0b114bf77` unchanged. One separately reset, bounded core capture
(`YJD6QBG56XQ2S4FBAL6X5AAHX4`) reached its first image at 8.905 seconds,
playable at 9.004 seconds (plan 1.977 seconds), and cold-seek playing at 4.271
seconds. Startup plus five playing seconds had zero underruns/drops; the next
20.005 seconds after seek 900 had zero underruns, drops, buffering, recovery
or repeated pages. This is a short capture, not another eight-minute pair.

Its playback HTTP reply started at **1395.25 seconds**, although the operator
had requested the same 1390.5-second reset. The four preceding pair halves'
HTTP replies all independently show 1390.5. That drift was reported to Ether
before requesting any further controlled comparison. The different initial
position and uncontrolled CDN timing prevent attributing startup/seek timing
changes to the dial-spacing patch alone. No client reserve or reader tuning
was made between these captures.

UI stop and grant revoke returned 200; mounted players were zero and the own
Chrome/context/profile closed. The architect was released. Operator unpin and
producer correlation were requested; no further stream or reset was requested.
The production wrapper remains the default.

Operator correlation confirmed the staircase **still exists** on `977550aa9`:
open waits of 0.32/0.56 seconds, then 0.25/0.50/0.75 seconds after an early end;
the seek also paid 0.50/0.75 seconds. Buffer ahead was zero in the first two
throughput samples. The patch exempts foreground dials, but this streamed reader
joins read-ahead runs, which remain paced. Ether is implementing a separate
low-water/open/seek exception for those runs. Thus the clean twenty-second
capture does not prove that the proposed connection mechanism was fixed.

The operator's reset-time Plex metadata did report 1,390,500 ms, whereas Vela's
revision-1 playback reply reported 1395.25 seconds. The Vela resume read path
remains under investigation; neither stale state nor snapping has been proven.
Unpin returned 204, the independent pin list is empty, and the operator confirmed
zero sessions. No additional reset or playback was requested.

The operator subsequently verified that `state_watch` stays at 1390.5 seconds
for ten seconds and across a full restart after the reset. The server's play
handler uses that live value when the request omits `positionSeconds`; an
explicit request value wins. Home hero resume actions instead embed the watch
position captured when cached Home rows were built. The client's source layer
passes that supplied position through to `api.playback`. Therefore a stale
cached hero is a supported explanation for 1395.25; the old capture did not
record its outgoing position, so that last causal link remains an inference,
not observed request evidence. Ether queued the hero action correction.

Fresh private controlled drivers now record only the outgoing position scalar
(and whether it was present), plus the opening HTTP plan position. They require
that ready plan to equal 1390.5 seconds before continuing into timed playback;
a mismatch runs the normal stop/revoke/context cleanup and invalidates the run.
They neither rewrite a playback request nor open detail, which would change the
cold/prewarm conditions. The completed evidence/driver files were preserved.
Only syntax checks ran for these new guards; no new browser, stream or reset
was started. A future controlled run still needs the server's low-water fix and
a fresh authorized reset.

## Controlled short capture with read-ahead low-water admission

Ether integration `50da5db16` adds the read-ahead low-water exception and removes
embedded positions from hero resume actions. Client signed 0.1.43 and runtime
`b76cabc0b114bf77` remained unchanged. In `paired43h-core.json`, the guard observed
`requestHasPosition=false` and HTTP plan `positionSeconds=1390.5`. The exact
requested reset now reaches playback end to end.

The bounded direct capture (`GZY32AQEPGGN3SAJL5NIK4XFVI`) reached first image at
7.213 seconds, playable at 7.315 seconds, and seek-900 playing at 4.072 seconds.
Startup plus five playing seconds and 20.007 post-seek seconds had zero
underruns, drops, buffering, recovery and repeated pages. Stop/revoke returned
200, mounted players were zero, and the own Chrome/context/profile closed.
The operator unpinned (204), independently read an empty pin list and confirmed
zero sessions.

This time the producer mechanism is actually confirmed: no open dial/cap waits,
and two early closes caused no staircase. The seek had isolated 0.31/0.32-second
waits, rather than the old 0.25/0.50/0.75 sequence. The one slow response had
only 4.6 ms connection wait and was CDN TTFB. Goodput was 80.6–82.8 Mbps. This
short clean capture is still not a paired or eight-minute qualification.
The architect cleared a fresh alternating-pair window; the same new server,
client and runtime will stay fixed, with resume guards and identical resets.

## Alternating cold pairs on the fixed low-water server

Both pairs then ran on fixed Ether `50da5db16`, signed Vela 0.1.43/host
`70623c5d…a567`, core `b76cabc0b114bf77` and production wrapper `3c579f70de6e1cfe`.
Every half used the same source-only purge, RAM reset, live resume 1390.5 and
independently verified `525f3640…` pin. All four requests omitted the position;
all four opening HTTP plans passed the exact 1390.5-second guard. There was no
detail visit, client tuning, release install or server change between halves.
The architect kept performance traces paused until final browser cleanup.

| Half | Plan | First image (post-plan) | Playable | Seek 900 | Startup five-second window | Post-seek window |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| A1 core first | 1.972 s | 10.963 s (8.992 s) | 11.182 s | 4.111 s | 0 underruns / 0 drops | 480 s, all zero |
| A2 wrapper second | 1.827 s | 6.693 s (4.866 s) | 6.709 s | 3.223 s | 0 underruns / 0 drops | 480 s, all zero |
| B1 wrapper first | 1.871 s | 6.794 s (4.922 s) | 6.800 s | 3.219 s | 1 underrun (157 ms) / 3 drops | 480 s, all zero |
| B2 core second | 1.888 s | 8.106 s (6.219 s) | 8.162 s | 2.915 s | 0 underruns / 0 drops | 480 s, all zero |

"All zero" means zero added underruns, drops, buffering intervals, recovery and
fallback. Every half remained direct with zero retries. Both core runs also had
zero repeated completed pages throughout, including startup, seek and the full
480-second samples. A1 validated 4,081,102,320 bytes with 4,082,675,184 received;
B2 validated 4,098,665,968 with 4,101,287,408 received. Each final epoch had
15,251 unique pages and zero repeats. Both delivered 11,508 presented frames in
the post-seek sample. The cache-thrash correction and sustained parity hold.

The B1 startup event is taken from its complete saved `beforeSeek` snapshot,
not the zero counters at its first frame. A message that initially missed that
five-second interval was corrected. B1 had 7,552 missing 48-kHz output frames
(157 ms) and three drops before the seek; its post-seek sample was clean. No
claim is made about unobserved subsecond buffering during that initial interval.

Producer post-seek buffer minimum/median was 16.3/98.6 MB for A1 core,
45.6/93.8 MB for A2 wrapper, 37.2/94.4 MB for B1 wrapper, and 76.0/99.1 MB for
B2 core. All runs kept four RD runs where demand required them. Steady-state
pacing above the low-water mark remains intentional; it must not be confused
with the removed open/seek staircase. CDN TTFB remained variable. A1's metadata
critical path included a 1.41-second RD response with only 1.4 ms connection
wait. B2's first-media path included a 1.38-second response with 2 ms wait.

### What the range trace establishes

The reversed pair added identical passive request timing to both private
drivers. Records contain only numeric byte ranges, status, content length and
network timing, plus timestamps. They contain no URLs, credentials, payloads or
other headers. No playback request or runtime behavior was changed.

The phase labels have different scopes: wrapper `metadata` is `probeOriginal`
(header/config and initial packet statistics), while core `metadata` includes
track discovery and deferred cue preparation. Their phase durations therefore
cannot alone establish which engine performs more serialized work.

In B2, the core read one 256-KiB header page, then eleven ranges covering the
2,665,968-byte deferred cue region. Cue requests started at 2.034 seconds and
finished around 3.878 seconds; several page groups waited on previous groups.
The first media page and adjacent 64-MiB streamed range started at 3.946 seconds,
with about 916-ms first byte. First presentation followed at 8.106 seconds.

In B1, the wrapper probed the file head, reopened cached header pages, made an
open-ended tail request at 4.219 seconds, then opened two media ranges at
4.274 seconds, about 9.57 MB apart. Their first bytes were about 920/923 ms.
First presentation followed at 6.794 seconds. These open-ended requests are
normally cancelled when the consumer has enough; their failure flags are not
playback faults. Requested range lengths and Content-Length do not prove actual
transferred body bytes for such cancelled requests.

Importantly, B2's first media request started **earlier** than the wrapper's,
so the cue phase alone cannot explain its 1.313-second later presentation.
The producer's 1.38-second body-block TTFB is on that core critical path. An
opportunity remains to overlap useful first-media acquisition with cue-tail
preparation, or make initial independent demands concurrent, while preserving
bounded memory and zero duplicated completed pages. That is a lead for a local
reproduction and measurement, not a proven fix or a reason to loosen reserve.
No change was made during these pairs.

Private evidence: `paired43i-{core,wrapper}.json` and
`paired43j-{wrapper,core}.json`, with final playing screenshots. All four stop
commands returned 200/ended, all four exact grants were revoked with 200,
mounted players were zero, and every owned Chrome/context/profile closed.
The operator unpinned with 204, independently confirmed an empty pin list,
zero sessions and zero Ether FFmpeg, and released the client/server hold. The
architect's performance window was explicitly released. No reset or further
playback was requested after B2.

**The production-default condition is still not met.** The core starts slower
in both new pairs, and its seek is slower in A and faster in B. Sustained playback
is clean, and the core avoids B1's startup underrun, but those facts do not make
it equal or faster on every requested metric. No default switch is proposed;
prior failed or differently versioned pairs are not relabelled as qualification.

## Resume-window overlap implementation (local qualification pending)

The next core change starts a network-only 16-MiB window around the byte estimate
`sourceSize × resumeTime / metadataDuration` as track metadata becomes available,
while deferred Cues is still being read. It does not establish a playback cursor
or feed any estimated bytes to the decoder. Cues still selects the actual
cluster. A matching window is adopted; a miss cancels its unfinished request and
starts authoritative acquisition. Completed warmed pages remain in the bounded
source cache, so correction does not evict and later refetch completed pages.
The actual Cues cluster's EBML header and timestamp are checked in warmed bytes
when present, and the existing authoritative parser continues to gate packets.

The transport exposes optional `speculateMedia` on its borrowed byte-reader
boundary. Speculative requests use the same pinned length/revision, scoped
fetcher, request-slot bound, streaming publication, cancellation and shared page
promises as ordinary forward media. Their edge is the explicit bounded window;
they never advance the media playhead or clock. The back-buffer allowance is
64 MiB so metadata, a missed window and parser leases cannot fight the front
window. Total raw cache remains 72–128 MiB, with no speculative extra cache.
Unknown duration, start zero and non-Matroska sources retain the existing path.

Scoped TypeScript passed. A private generated-fixture proof is prepared with
2-second cue first-byte latency, 400-ms media first-byte latency and a shared
65-Mbps body limit, comparing first-media request, first presentation, reserve,
correct target frames, repeated pages and cache capacity for hit and miss cases.
Matching asset assembly is queued under the shared build lock. This change is
not yet locally or lab qualified; production remains the frozen wrapper and no
further lab pair has been started.

## Cues-stream correction and local overlap proof

The exact real-file duration (8888.299 seconds) showed that the average-rate
1390.5-second estimate is 23.29 MiB before the known video range. A centred
16-MiB window therefore misses that source. The implementation was extended
before qualification: deferred Cues now uses a bounded streaming metadata
request instead of page-sized network round trips. Complete CuePoints in each
arriving prefix can redirect media warming to the nearest preceding video
cluster before the remaining index arrives. Only the full library index admits
the packet cursor. Prefix parse errors or truncation cannot weaken admission.
The initial estimate and partial-index hint never set the clock or relabel time.

Authoritative foreground reads can split a speculative run; warming cannot
preempt itself. Shared promises and cached pages survive adoption, and miss
cancellation retains completed pages inside the existing bounded cache. Cues
pages are marked metadata. The source, ETag, length, scope and redirect checks
are shared with normal reads. Scoped TypeScript and matching asset assembly
passed for runtime `4f43df6016245ce1`.

The generated 608.76-second 4K HEVC Main10/PQ + DTS fixture averages 46.9 Mbps;
HTTP bodies were capped at 65 Mbps aggregate, with 2-second Cues first-byte
latency and 400-ms media first-byte latency per request. Separate owned headed
Chrome contexts disabled service workers. The same fixture and throttle were
used before and after:

| Metric, resume 48.08 s | Before (b76) | Overlap (4f43) |
| --- | ---: | ---: |
| First media request minus first Cues request | 2028.842 ms | 2.323 ms |
| First presented frame | 3.725 s | 2.737 s |
| Playable | 5.843 s | 3.695 s |
| HTTP requests through two playing seconds | 11 | 5 |
| Validated bytes | 29,478,614 | 37,867,222 |
| Completed-page repeats / underruns | 0 / 0 | 0 / 0 |

First-media acquisition moved earlier by 2.027 seconds, approximately the Cues
wait. The extra 8 MiB acquired in the hit case is bounded warming before the
actual cluster, not a repeated page. The actual frame timestamp was 48.060 s,
covering target 48.08. Boundary validation against the authoritative Cues
position was recorded. Raw cache was 37,867,222 bytes against a 96,428,575-byte
bound; raw-cache maximum remains 128 MiB. These are measured local observations,
not statistical GPU timing claims.

A separate cold 52.5-second case deliberately missed: the initial window began
at byte 299,368,448 while Cues corrected acquisition to 281,804,800. It rendered
52.477 seconds (covering target), reached playable at 7.721 seconds, and had
zero completed-page repeats or underruns through two playing seconds. No speed
claim is made for this miss without a matched baseline.

A fourth case extended the same fixture's Cues with legal Void padding to
3.15 MB, adjusted Segment/Cues sizes and removed the replaced Cue CRC. It served
a virtual file from the original media plus small patched header/tail buffers;
no multi-gigabyte media copy was loaded into memory. With the same 52.5-second
miss, the partial CuePoint correction requested the true cluster at server
20,029.454 ms, before the streamed Cues response ended at 20,275.537 ms: 246 ms
of useful overlap despite the inaccurate estimate. Target frame, 128-MiB cache
bound, zero repeats and zero underruns passed. Cache use was 62,246,615 bytes
against 96,454,412. This checks correction before the tail completes rather than
merely issuing an irrelevant early estimate.

Private records/screenshots are `resume-warm-{before,after}-48.08`,
`resume-warm-after-52.5`, and `resume-padded-after-52.5` under `range-stream/`.
All four own Chrome contexts/profiles closed; both fixture servers stopped;
the architect's performance window was released. No lab stream was opened for
this proof. The matching immutable runtime still needs the requested controlled
pair in each order. Production remains the wrapper; default evaluation will use
the parent's updated relative/aggregate criterion, including the wrapper's own
underrun duration, drops and buffering, with no extra core fallback/recovery or
refetch failure mode permitted.

## Overlap candidate: two controlled pairs on 50da5db16

The requested two orders completed with signed 0.1.43/host `70623c5d…a567`,
wrapper `3c579` and overlap core `4f43`, fixed throughout all four fresh cold
resets. Every outgoing position was omitted; every opening plan was 1390.5 s.
Startup was sampled every 100 ms for five seconds after playable, then each
cold seek to 900 was followed by 480 seconds. All source pins were independently
verified. Raw private files: `paired43k-{core,wrapper}.json` and
`paired43l-{wrapper,core}.json`.

| Half | Plan | First image | Playable | Seek | Startup drops | Post-seek drops |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 core first | 2.250 s | 8.857 s | 9.859 s | 3.958 s | 0 | 0 |
| A2 wrapper second | 1.848 s | 7.009 s | 7.025 s | 2.402 s | 0 | 3 |
| B1 wrapper first | 1.954 s | 7.730 s | 7.735 s | 2.527 s | 0 | 0 |
| B2 core second | 2.000 s | 6.100 s | 9.674 s | 2.743 s | 1 | 0 |

All four startup and post-seek windows had zero underruns (count and duration),
zero buffering, zero retries, and zero fallback/recovery. Both core runs had
zero repeated completed pages and 15,251 unique pages in their final epochs.
Core totaled one drop against wrapper's three. Thus reliability is at least at
parity on this sample; absolute zero was not imposed on the wrapper comparison.

Mean first-image time was core 7.479 s versus wrapper 7.369 s. After plan arrival
it was core 5.354 s versus wrapper 5.468 s. First image is now approximately equal,
but actual playable and seek means remain slower: 9.766/3.351 s versus
7.380/2.465 s. No weighted score is invented to erase those differences.

The core's startup reserve held 0.964 and 3.465 s; seek reserve held 1.429 and
0.441 s. Those holds closely account for the remaining mean playable (+2.387 s)
and seek (+0.886 s) gaps. Subtracting a hold is diagnostic decomposition, not a
qualification result: viewers experience the actual hold. B2 had three host-cap
waits (250–336 ms) inside the startup hold and supply below consumption
(68.9/80.6 Mbps), so blindly reducing it would remove a real safety margin.

The real-file estimate missed as predicted. A1 guessed a 16-MiB window at
11,393,826,816 bytes, then corrected to 11,426,856,960. It opened a following
64-MiB run while the corrected 16-MiB run was still active. Before first
presentation it had acquired 67.15 MB, including speculative data, compared
with about 28 MB in the earlier b76 run. This is bounded extra unique acquisition,
not refetch. It remains a potential cost to measure, not a demonstrated free
startup optimization. Corrected warm/Cues overlap exists in the trace, but the
local hit-case gain is not asserted as a universal real-file speedup.

Ether also cancelled an internal read at 11,232,870,400 at the seek in both core
halves, and a similar block in the wrapper. No browser request covers that offset;
the producer confirmed it is a block-aligned internal read and is investigating
warm/read-behind ownership separately. It was not a startup explanation.

Every half stopped and revoked via UI (all 200), mounted players were zero,
all dedicated browsers/contexts/profiles closed. The operator unpinned (204),
read pins empty and confirmed zero sessions/FFmpeg; baseline hold was released.
The architect received FINISHED before its quiet performance A/B. No further
playback was requested. No default switch was proposed from this result.

The parent's next step is delivery-aware reserve admission: a small PCM target
only when priming goodput is >=1.3x media bitrate AND contiguous forward bytes
cover >=2 seconds; retain full reserve for under-supply or cap waits. Healthy
and under-supplied local proofs must precede another pair in each order.
