# Core qualification on lab.28–lab.30

The production default remains the qualified wrapper. These are actual-app
cinematic candidate results, with matching host, data module and core assets;
no worker fetch interception or production default change was used.

Candidate `764f0ef`, payload `aabe60fb84eff243`, includes streaming embedded PGS
and native SDR presentation with unknown container colour. The lab used the
production-bundled Jellyfin FFmpeg 8.1.3.

## Streaming embedded PGS (lab.28)

Pinned Inception release `525f3640da729300e2e6562e155516ff23c29212` is the
jennaortegaUHD 2160p HEVC DV8/HDR10+ remux with DTS-HD MA 5.1. Ether independently
confirmed direct original delivery, no transcode and no FFmpeg. At a 220-second
seek, selecting English PGS painted 29,230 overlay pixels at 220.430 seconds.
The screenshot visibly showed the English caption. Source generation stayed 1;
there was no tracks/burn/switch request. Off removed the canvas. No subtitle
failure or fallback occurred. This supersedes the earlier subtitle-index gate:
selected PGS is collected from already-read AV clusters, not subtitle Cues.

That longer run still accumulated audio underruns, including after PGS Off:
7 at 335.8 seconds, then 25 at 471.6 seconds. Thus it was not a clean sustained
AV qualification. Lifetime bytes include the opening region, seek preroll and
read-ahead; dividing them only by post-seek media time does not establish that
region's bitrate or a percentage delivery deficit.

## Real live (lab.30)

The real watch view played CHROMA 80, H.264 1920x1080/AAC in MPEG-TS HLS,
through the core's demux, WebCodecs, AudioWorklet and WebGPU path. Unknown SDR
colour facts no longer caused admission failure. The screenshot showed the
broadcast, with working chrome; no MSE fallback or parse failure occurred.

| Measurement | Result |
| --- | --- |
| First frame | 3,397.8 ms: plan 1,597.8 ms, post-plan 1,800.0 ms |
| Final media position | 85.671 s |
| Decoded / presented / dropped | 2,454 / 2,445 / 0 |
| Audio underruns | 2 early, unchanged for the remainder |
| Exact playlist edge | 0.5 → 92 s; window slid to 68–92 s |
| Go live | Stayed on core, drift 10.196 → 5.666 s at the 2.5-second sample |
| Presentation lag | final 5.305 ms, maximum 30.081 ms |

Only automatic latency policy and Go live were exposed. This is a bounded
moving-window check, not a long broadcast-splice or metadata-epoch-rotation proof.
The 3.40-second start misses the live-start target and the early underruns remain
open. UI stop returned 200/ended; revoke returned 200/accepted; mounted players
fell to zero and the dedicated Chrome closed. Ether confirmed session release
and the designed 60-second broadcast linger then stopped.

## Cold post-seek UHD (lab.30)

Same unchanged candidate and reader/priming as lab.28. Fresh dedicated Chrome,
pinned same Inception release. Start resumed at 471.200 seconds; seek target 900
was a region not used in the preceding 220–472-second check. This is not a claim
of cleared shared server caches. PGS stayed Off to isolate AV delivery.

| Measurement | Result |
| --- | --- |
| First frame at resume | 715.2 ms: plan 164.3 ms, post-plan 550.9 ms |
| Seek to 900 | 4,067.6 ms; authorization HTTP 6 ms |
| Sample wall interval | 04:32:52.891–04:40:52.919 EST, 480.005 s |
| Media advanced | 477.619 s |
| Decoded / presented during sample | 11,453 / 11,451 |
| New video drops | 0; one initial-resume drop predates the seek |
| Audio underruns | 9 by the first check at +46.1 s; unchanged for 7 min 14 s |
| Presentation lag | final 2.505 ms, lifetime maximum 25.287 ms |
| Route | Direct core throughout; no failure or fallback |

Browser scalar ResourceTiming samples around the seek had p95/max TTFB
830/1,132 ms in the five seconds before first playing, and maximum 862 ms in the
first ten seconds after. After +10 seconds, every measured completed range in
the remaining sample had TTFB at most 31.8 ms. The long-task observer, installed
at +82 seconds, reported no main-thread tasks over 50 ms thereafter.

Ether independently confirmed release 525f3640, direct delivery and no transcode.
Its 10-second throughput series showed the ramp at 43 Mbps, one run and zero
buffered ahead; then 61.2 Mbps / 19.9 MB ahead at +10 seconds and 67.6 Mbps /
58.7 MB ahead at +20 seconds. Once established, goodput tracked consumption at
79–93 Mbps through heavier scenes, with mostly four runs and 92–126 MB ahead.
Later lighter scenes retained at least 50 MB ahead. There were six slow source
responses, all in the seek ramp, zero range failures, and no steady-state loss
of buffer. Server-side RD median TTFB was about 400 ms; the first cold read also
waited 0.75 seconds for admission. Fast browser TTFB later reflects Ether's
read-ahead, not a claim that RD itself became a low-latency LAN source.

Stop returned 200/ended, revoke 200/accepted, mounted players zero, Chrome closed.
Ether deleted the pin (204 plus independent empty pin list) and confirmed zero
sessions. Core default remains held: adaptive cold-start/seek buffering and a
paired production-wrapper comparison are next. Sustained delivery is improved;
the cold ramp and live startup are not a zero-underrun or latency-target pass.

## Adaptive priming local proof (pending paired lab comparison)

The adaptive implementation measures actual delivery and packet bitrate rather
than trusting descriptive metadata. A generated H.264/AAC MKV was served with a
controlled 400 ms delay on range responses, in a fresh headed Chrome for the
corrected candidate. The source reader, native decoder, output worker and real
AudioWorklet were used. No lab source was opened for this proof.

| Measurement | Existing core | Adaptive core |
| --- | --- | --- |
| First visible target frame | 566.6 ms | 568.7 ms |
| Open resolves / audio allowed to run | 563.5 ms | 1,737.1 ms |
| Initial audio underruns | 2 | 0 |
| Seek to 4.5 s | 3,321.7 ms | 2,892.5 ms |
| Post-seek audio underruns | 2 | 0 |
| Video drops / failures | 0 / 0 | 0 / 0 |

The original core exposes presentation just before its open promise resolves;
the five-millisecond visibility sampler adds quantization to the first-frame
numbers. These are short local component measurements, not a claimed RD seek
speed improvement. The corrected adaptive start held 1,170.3 ms, with measured
TTFB 406.9 ms, requested reserve 0.814 s and reported reserve 1.977 s at release.
The seek needed no extra hold: 1.847 s was already buffered against a 1.8 s target.
Neither release hit the cap. The earlier eight-credit attempt prevented underruns
but could only report 0.3–0.4 s buffered and exhausted its three-second hold; it
was corrected before the candidate was committed. Both local browsers and the
owned local server were stopped. Paired, equally cold real-source runs remain
pending; the production default has not changed.
