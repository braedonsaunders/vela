# Streaming Matroska core: installed 0.1.42 pair

Both halves used installed Vela 0.1.42 (`dc943581`) and the same Ether
0.3.12-lab.33 binary. The installed host SHA256 was identical:
`636b532d0a3963c7b3e2d8ef404710f781f496d7142ce062d00871498573a046`.
Only the in-memory runtime descriptor changed: production wrapper
`3c579f70de6e1cfe`, then streaming core `85914f49ea9e9697` (`ca7e659`).

Before each half Ether set resume to 1390.5 s, deleted only the target release's
cache, restarted the same binary to clear RAM, and independently verified the
pin and empty cache/sessions. Both played Inception's actual pinned
`525f3640da729300e2e6562e155516ff23c29212` release:
`Inception.2010.INTERNAL.SPECIAL.2160p.REMUX.HEVC.DV.HDR10+.DTS-HD.MA.5.1-jennaortegaUHD`.
Ether confirmed direct original delivery with no conversion. Dedicated headed
Chrome profiles blocked service workers and disabled HTTP cache. No detail
prewarm preceded Play. Architect performance traces were asked to pause.
Real-Debrid CDN warmth, other machine activity and GPU/driver caches were not
controlled. Memory headroom was 3.70 GB before wrapper launch and 7.48 GB before
core launch. This is one sequential pair, not a statistical performance claim.

| Metric | Wrapper | Streaming core |
| --- | ---: | ---: |
| Plan | 2.695 s | 2.041 s |
| Play to first presentation | 13.079 s | 5.700 s |
| Post-plan first presentation | 10.384 s | 3.659 s |
| Play to playable | 13.183 s | 8.740 s |
| Initial direct retries | 1 (eight-second first-frame deadline) | 0 |
| Cold seek to 900 s, until playing | 7.200 s | 5.669 s |
| Initial/pre-seek audio underruns | 0 | 1 / 13,904 output frames |
| Measured post-seek wall time | 480.007 s | 480.006 s |
| Media advance during window | 480.042 s | 479.992 s |
| Decoded / presented frames added | 11,535 / 11,509 | 11,508 / 11,508 |
| Added drops / underruns / underrun frames | 0 / 0 / 0 | 0 / 0 / 0 |
| Window stalls / fallback | 0 / 0 | 0 / 0 |

Core audio had zero underruns at the initial playing snapshot, then one by the
snapshot five seconds later, before issuing the seek. It was not a seek or
steady-state underrun. The clean post-seek window does not erase this gap.
Core epoch-two source acquisition finished with 15,198 unique page requests
and zero repeated page requests. Reader lifetime bytes were 4,046,543,840.
Client source/encoded buffer audit fields were unavailable in this run; do not
substitute Ether's server buffer for a measured client reserve.

Ether correlation: wrapper session `4a805a51`, core `1681ef8a`. The cold probe
took 2.04 / 1.77 s. Wrapper open/seek had twelve slow responses; core had
thirteen across open and seek. Dial-spacing waits of about 0.4–0.9 s preceded
core seek refill. Sustained server buffered-ahead medians were 78.1 / 81.0 MB;
the core's initial series had only 0.3 MB ahead at 38.5 Mbps goodput against
58.2 Mbps consumption. These observations motivate tracing the initial PCM
reserve and physical-clock release; they do not prove a decoder failure.

Vela sessions were `4TSLCD2WTQWN5APPPLP4OY72JO` and
`KIZXMTSLV3LJAXH2ASZFP3DMSW`. Each Stop and revoke returned 200, mounted players
fell to zero, and each dedicated Chrome context closed and its profile was
removed. Ether independently confirmed unpin 204, pins empty, zero sessions
and zero FFmpeg processes. The server-change hold and architect trace hold
were released afterward.

Verdict: first-frame, playable, seek and retry results improve, and sustained
direct playback ties. Initial audio continuity is not yet at parity. Production
remains on the wrapper. Next: trace and repair cold-start PCM priming locally,
then two more cold pairs with order alternated before proposing a default
switch. No new lab stream is running.

## Initial PCM reserve repair

The reserve used `min(reserveBegin + 3 s, originalFirstFrameDeadline - 100 ms)`.
If video acquisition/preroll consumed that deadline, the reserve could return
`capped=true` with no PCM, then request audio playback. The output's normal
80-ms arming threshold subsequently started the physical clock, regardless of
the adaptive 1.8-second reserve target. The existing 48-credit core adaptation
can hold two seconds of PCM; an eight-credit queue was not this failure.

The first-frame deadline now clears on actual presentation. PCM acquisition is
bounded separately (eight seconds total); the extra adaptive hold is at most
three seconds after the first usable PCM. The clock is released only after the
reserve is met, or the real EOF tail is established. Insufficient reserve at
the bound fails into recovery instead of arming an empty output. Output queue
capacity, credit limits, media timing and decoder selection are unchanged.

Local headed Chrome proof used the same generated 4K Main10/PQ plus DTS-core
fixture at 4.5 s, an 800-ms initial source wait, aggregate 32 Mbps for the first
eight seconds then 65 Mbps, and a documented one-time 650-ms pause in compressed
audio input at media 4.807 s. The pause models a cold packet-delivery gap; it is
not a captured or exact reproduction of the lab's network trace. Both runs used
fresh profiles with service workers blocked and HTTP cache disabled.

| Scalar from local timeline | Core 859 | Repaired core 18273ed7e9bd2a39 |
| --- | ---: | ---: |
| Reserve begins | 7.676 s | 7.649 s |
| Reserve ends | 8.075 s | 9.939 s |
| Adaptive reserve target | 1.8 s | 1.8 s |
| PCM at playback request | 0 frames | 88,000 frames / 1.833 s |
| Reserve capped | Yes | No |
| First physical audio-clock report | 8.634 s | 9.939 s |
| Open/playable | 8.075 s | 9.939 s |
| Audio underruns / missing output frames | 1 / 23,232 | 0 / 0 |

The old physical-clock report followed only about 125 ms of submitted PCM; the
gap then emptied it. The repair absorbs the gap while the clock is stopped.
The measured tradeoff is 1.864 s longer to playable in this adverse local case,
with no audio hole. A normal 65-Mbps trace before the repair already filled
96,000 PCM frames before playing; the unsafe capped branch was the defect.
The scoped TypeScript check and matching asset build passed. Both local browser
contexts and the fixture server were closed. Further lab pairs remain required;
the original 859 pair's startup underrun is still a recorded failure.
