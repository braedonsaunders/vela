# Matroska cluster reuse and buffer audit

Production stays on the qualified wrapper. This fixes a measured demux
inefficiency; it does not identify the lost exception in the failed cold-900 run.

The pinned Matroska demuxer retains only `segment.lastReadCluster`. The core's
video packet queue and audio decoder read at different positions. Each consumer
replaced the other's parsed cluster, so its next packet reparsed the same bytes.
The PGS tap observed those parses; it did not request them. Sequential packet
lookups already avoid reloading Cues when a preceding packet supplies a cluster
position.

The core build now shares parsed clusters across those consumers and coalesces
in-flight parses. The cache belongs to one demux epoch, is bounded to 16 entries,
32 MiB of charged data/metadata and 65,536 blocks, and copies no cluster or packet
bytes. Eviction clears the upstream last-cluster shortcut if it references the
evicted entry. Source and seek replacement construct a new demux epoch. The
source-scoped 32 MiB range-page cache and its three-request concurrency are
unchanged. The pinned checkout is untouched; the build ships the adaptation's
corresponding source alongside the MPL source archive.

## Same generated fixture, before and after

The 3,879,269-byte MKV has 17 AV clusters and more than 120,000 extra subtitle
Cues. The private proof reads 48 video packets ahead, then alternates video and
audio, finally draining audio. A second proof feeds the actual `RangeReader`
with an in-process strict-206 range adapter and counts its physical requests.
No lab source or browser capture is used.

| Measurement | Before | After |
| --- | --- | --- |
| Parsed clusters | 322 | 17 (each exactly once) |
| Demux-to-reader calls | 987 | 89 |
| Demux-requested bytes | 39,943,317 | 2,315,884 |
| Physical range requests | 8 | 8 |
| Physical range bytes | 2,097,152 | 2,097,152 |
| Repeated physical pages | 0 | 0 |
| Video / audio packets | 192 / 346 | 192 / 346 |
| Packet checksum | 2,143,798,264 | 2,143,798,264 |

Unused subtitle-index bytes need not be acquired. After the run, the parsed
cache held 16 entries, 1,842,809 source bytes and 1,972,089 charged bytes, with one
eviction. A separate concurrency/bound proof joined ten simultaneous requests
into one load and evicted eight of 24 one-MiB entries, retaining at most 16.

The distinction matters: the small fixture showed roughly 10x demux read
amplification, **not** 10x network bandwidth. The existing range cache already
prevented repeated physical downloads. Larger working sets can behave
differently; a bounded cache cannot promise permanent retention of an entire
multi-hour file. The paired lab run must measure physical ranges independently.

## Buffer observability, without tuning

`prepare-upstream.ts --buffer-audit` adds diagnostic hooks to either runtime.
The wrapper reports `telemetry.videoDecode.velaBuffer`; the core reports
`presentationTelemetry.bufferAudit.source` with the same scalar shape:

- `cacheBytes`: all retained raw bytes, including pinned headers/indexes;
  `cacheLimitBytes`: the evictable cache limit; `readAheadLimitBytes`: configured
  source prefetch, not claimed downloaded media.
- `forwardBytes`: contiguous cached bytes beyond the latest demuxed AV cluster,
  excluding disjoint ranges and already-parsed clusters. This is raw file data:
  a contiguous trailing index can be included. It is not independently a claim
  of playable media bytes; use the proved time bounds too.
- `cachedStartSeconds` / `cachedEndSeconds`: conservative complete-cluster
  boundaries proved by the already-loaded AV cue index and contiguous cached
  bytes. Unknown or non-monotonic indexes yield null. They are not bytes divided
  by an average bitrate. Count seconds ahead only if the playhead is inside the
  proved interval.
- `videoReadEndSeconds` / `audioReadEndSeconds`: actual packet-read frontiers.
  These differ from decoded AV and raw source prefetch.

The core additionally reports actual encoded-video queued bytes, packet count
and summed packet duration, and parsed-cluster cache counters. The wrapper audit
publishes twice a second, checks worker generation, and stops on run retirement.
It reads existing cache/index metadata, stores no URLs or packet bytes, and adds
no media request. Diagnostic sources ship with the payload. Normal builds omit
the hook; this does not widen capability advertisement or change defaults.
Wrapper timestamps are projected through its existing container/title origin.
Core reader metrics also expose `sourceEpoch`, `uniquePageRequests` and
`repeatedPageRequests`. A bitmap (at most one MiB) tracks validated physical
range acquisitions in each demux/seek epoch; old in-flight acquisitions remain
attributed to their requesting epoch. This distinguishes repeated parser reads
served from memory from genuine repeated HTTP page requests. Files beyond the
bitmap's bound report unknown rather than a false zero. Retries of a truncated
206 also count as repeats; request failures remain a separate cause.
A generated 64-MiB range-adapter proof acquired 131 unique pages, deliberately
re-read one evicted page and reported exactly one repeat. Cache hits added no
acquisition, an old in-flight read did not change the new epoch's counters, and
a three-TiB virtual source reported unknown tracking without a large allocation.
The coverage calculation uses the complete contiguous cached component,
including bytes before the latest packet-read cursor. A cursor already ahead
of the playhead must not hide earlier cached coverage. Disjoint cache regions
still cannot bridge a missing interval.

The cache-enabled core also passed one headed local PGS/seek regression on this
fixture: 14,300 overlay pixels at 1.5 s and 4.5 s, 142.1 ms for the paused seek
and repaint, zero pixels at 7.5 s and no overlay canvas after Off. No subtitle
Cues walk, failure or server command occurred. Across discovery and those seeks,
the reader acquired exactly the file's 3,879,269 bytes in 15 unique physical
pages. The final raw forward count included the trailing subtitle index while
indexed time was unknown, illustrating why the counters stay separate. All
owned local browser/runtime/server resources were closed.

The wrapper's source policy is already time-sized: five seconds of read-ahead
(8–64 MiB), fifteen seconds of evictable cache (32–192 MiB), based on actual file
size/duration. Prior roughly 0.36-second telemetry measured decoded AV only.
No new buffer policy is justified until actual source and encoded reserves are
compared on the real file.

A separate 25-second warm-source wrapper audit on lab.31 (audit key 86682, not
the paired production baseline) measured zero drops/underruns, 31–43 MB of raw
forward cache, 128–129 MB total retained, a 41,000,970-byte read-ahead limit and
123,002,910-byte evictable-cache limit. Its initial time-bound calculation used
the cursor rather than the whole cached component, so it could not establish
continuous seconds ahead; that diagnostic was corrected before the paired run.
Restoring the resume point after measurement timed out because the HUD was
hidden; the UI owner confirmed expected pointer-wake semantics. Stop/revoke
returned 200, mounted players zero and the dedicated browser closed. The next
pair sets the test viewer's 1390.5-second resume on the server before each reset,
and performs no extra restoration seek after the measured window.

## Unchanged adaptive-runtime local DTS check

A generated 70.144-second H.264/DTS-core 6-channel 44.1-kHz MKV, with 400-ms
range delays, opened in 2,588.6 ms and sought to 30 s in 6,521.8 ms. It passed
23.7 seconds after seek without a hard fault, decoded 1,342 frames and dropped
none. Three underruns preceded EOF. After the final video frame at 70.009 s it
remained buffering with no media to play; that separate EOF/tail issue remains
unresolved. The extra internal EOF state was not retained before disposal, so
no EOF cause is claimed. This DTS-core fixture is not a DTS-HD MA/HEVC proof or
a reproduction of the lost UHD exception. The dedicated local browser, runtime
and server were closed.

## Corrected reserve audit and cold lab.31 attempts

The corrected 25-second wrapper audit (5f7ca210a23dfd9a) measured 6.23–11.32 s
of index-proven continuous source reserve, 41.1–43.1 MB raw forward cache and
128–129 MB retained. Decoded AV remained about 0.4 s. It had zero measured drops
or underruns; this was a warm audit, not a cold parity baseline.

The subsequent cold comparison used installed 0.1.39 host/data bytes in both
contexts. The wrapper kept the production 3c579 descriptor; only the core
context selected verified 1f3f784d02664c0c. Both used identical export-only
scalar instrumentation, disabled browser HTTP cache and blocked service workers.
Before each run Ether set resume to 1390.5 s, purged only the pinned Inception
525f3640 release cache and restarted the unchanged lab.31 binary. CDN warmth
cannot be controlled. No detail page was opened.

| Metric | Installed wrapper | Repaired core |
| --- | --- | --- |
| POST playback | 1,857 ms | 1,868 ms |
| First universal frame | Unavailable: direct retired | 6,430 ms |
| Playable audio | Unavailable for direct | 9,329 ms |
| Cold seek to 900 s | Not reached | 4,208 ms |
| Direct sample | Not started | 26.1 s before false recovery |
| Measured drops / underruns after seek | Unavailable | 0 / 0 |
| Eight-minute direct parity | Not established | Not established |

Wrapper session AQCWPXNDWMBI2HGSDG2XJO6A3W switched to fallback-hls about 8.3 s
after the plan, before a universal presented frame. Ether observed a 1.79-second
cold probe and an early 1.32-second range including a 0.98-second cap wait. The
universal-only frame waiter expired at 25 s; that does **not** establish absent
HLS pixels. HLS watch position advanced to 1401.36 s. A previous discarded
attempt stopped before seek on an overly strict driver implementation-label
check; it is not a baseline either.

Core session MJZTX3U6LXOSBFGHEZ6PJBVAHD retained direct HEVC through the cold
seek. It counted three underruns and two drops before the measured window.
All 26.1 seconds subsequently sampled were playing, advancing 900 to 926.15 s,
with zero additional drops/underruns. At the final direct sample, epoch 2 had
912 unique physical page acquisitions and zero repeated page acquisitions.
Those are network acquisitions, separate from 3,516 parsed-cluster cache hits.

At 27.1 s after seek, durable recovery history recorded `Playback stalled for
30 seconds` at position 926.29 s and retired the direct route. Ether was still
delivering data and had accumulated 58 MB ahead. This was a host watchdog defect:
`seekRetainedOriginal` retained the pre-seek progress high-water mark near 1395 s.
The moving post-seek clock could not exceed it, so its last-advance timer expired.
The same mechanism can affect either runtime when it retains a source on a
backward seek; the original lost exception cannot be identified retroactively.

The host now resets its progress position/timers at the accepted seek epoch and
again on completion. Pending seeks cannot credit the old clock as new progress.
Local retained original/live seeks use the same reset. The stall limit remains
30 seconds. A private in-process proof exercised the actual engine: old clock
ignored while pending; 40 s of backward-seek progress without false recovery;
a true stationary clock still recovered at 30,001 ms; forward seek also advanced.
Scoped TypeScript and the host bundle passed. This is not yet a lab rerun.

Both cold attempts ended with Stop 200, revoke 200, zero mounted players and
closed dedicated Chrome. Ether independently confirmed no sessions or encoders
and removed the pin. The core stays gated; no eight-minute or default-switch
claim follows from these interrupted samples.
