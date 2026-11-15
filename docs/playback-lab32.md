# Cold Inception comparison on lab.32 and Vela 0.1.40

Production remains on the qualified wrapper. The core is gated.

Both runs used installed 0.1.40 (53fce6e9, including f31c7ea) host/data bytes;
read-only export instrumentation verified identical host SHA256. The wrapper
kept runtime 3c579f70de6e1cfe. Only the core browser's descriptor selected
1f3f784d02664c0c. No production descriptor/default, media bytes or credentials
were changed by the driver. Each dedicated headed context blocked service
workers and disabled browser HTTP cache.

Before each run Ether set the test viewer's resume to 1390.5 s, stopped the lab,
purged only release 525f3640's cache, restarted the same lab.32 binary (empty
in-memory cache), and independently confirmed the Inception jennaortegaUHD pin.
No detail page was opened. The source is HEVC 2160p DV/HDR10+ with DTS-HD MA 5.1;
the core reported its HDR10 base-layer path. CDN warmth is uncontrolled.

| Metric | Installed wrapper | Core |
| --- | --- | --- |
| Plan received | 1,971 ms | 1,832 ms |
| First universal frame from Play | 9,912 ms | 14,824 ms, after internal direct retry |
| Initial playable state | 9,934 ms | 16,430 ms |
| Cold seek to 900 s, direct | Unavailable: direct already retired | 6,215 ms |
| Eight-minute direct window | Unavailable | Completed, 480.05 s of media |
| Window decoded / presented frames | Unavailable | 11,522 / 11,508 |
| Window dropped frames | Unavailable | 1 |
| Window added underruns / underrun frames | Unavailable | 0 / 0 |
| Sampled buffering episodes / server fallback | Unavailable | 0 / 0 |

## Wrapper failure

Session TR2ATKR2YXQGSVDNBWEOHCTB4P presented two frames at about 7.93 s after
source admission. Roughly 30 ms later, its generic progress watchdog reported
`Playback did not start within 8 seconds`. Its clock had advanced only 16.3 ms,
below the watchdog's 20-ms progress threshold. It incorrectly retired a source
that had presented a frame. HLS/MSE then played. The automated seek reached
900 s on that fallback, so its 5,112-ms seek is **not** a direct-play metric and
no eight-minute wrapper baseline exists.

Ether saw a cold 1.86-s probe and one early 1.21-s response including a 0.75-s
connection wait. These costs do not justify the false watchdog decision after
presentation. HLS returned a stale media 410 during the transition; that is
recorded in durable history and not treated as a direct-play result.

## Core result

Session WWNR32BG47B3NUWPRH3IYCPKS3 hit the genuine first-frame deadline on its
first attempt and retried internally on the same direct source. Ether reported
only 13–14 MB delivered during the first ten seconds, client-paced, with no cap
waits or slow responses until the retry. This points to client startup work;
there is no claim that source delivery explains that first attempt.

After the 6,215-ms cold seek, the 480.055-s wall sample advanced the media clock
480.050 s. Source/seek generations stayed 1/2, HEVC/WebGPU stayed active, and no
new recovery occurred. Five underruns occurred **before** the measurement
window. The one dropped frame occurred around 107 s; no human lip-sync claim
is made. Maximum recorded presentation lag was 69 ms.

At completion, seek epoch 2 had 15,221 unique physical page acquisitions and
zero repeated acquisitions. Raw byte cache remained bounded at 32 MiB; parsed
cluster caching remained bounded at 16 entries/32 MiB, separate from queued
encoded packets. Lifetime reader bytes were 4,064,107,488; Ether independently
reported 4,081,453,520 delivered for the session, including other client reads.
The scalar counters establish that the previous parser amplification did not
become repeated HTTP page acquisition in this window.

Ether's steady post-seek series held 55.8–134.2 MB ahead (median 85.2 MB), with
37.3–94.6 Mbps goodput tracking 35.8–96.6 Mbps consumption and median TTFB
371–539 ms. All four slow responses were in open/retry, before the window.

## Startup-watchdog production repair

After closing the fixed-host comparison, the host was changed so a presented
frame, or any positive position advance backed by a decoded frame, establishes
startup. The generic and dedicated first-frame watchdogs use the same evidence;
the 20-ms threshold remains only for subsequent progress sampling. Pending
seeks cannot credit an old clock. Client startup timing initializes at source
admission after the plan arrives, independently of Play/server preparation.
The eight-second no-frame and thirty-second real-stall limits remain.

A private proof exercised actual engine methods with 45 seconds of simulated
server preparation before admission: an edge-of-deadline presented frame was
accepted; a 1-ms decoded advance counted as started; no-frame still timed out;
and a stationary started clock still recovered at 30,001 ms. The earlier
40-second backward-seek progress proof also passed. Scoped TypeScript and the
host bundle compiled. This repair has not yet been requalified on the lab.

Both runs ended with Stop 200, revoke 200, zero mounted players and closed
Chrome. Ether independently confirmed zero sessions/encoders and removed the
pin. Sustained core playback improved, but startup/seek miss the targets and a
valid wrapper long sample is absent. Overall parity/default-switch evidence
remains incomplete.
