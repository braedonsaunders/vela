# Final cold pair: Vela 0.1.41, Ether lab.33

The core stays gated. Steady playback matches the wrapper; startup and seek do
not. No production-default switch is proposed.

Both runs used installed 0.1.41 (3769bd2f, including 4f87587), with the same
host SHA256 `7ea4f8230118cc663fd1a8a07ef39a5232d2f918b42c6245dae160d6a48cc63b`.
The wrapper used the production 3c579f70de6e1cfe payload. Only the core browser's
runtime descriptor selected 1f3f784d02664c0c. Both had read-only export/scalar
instrumentation, a fresh uniquely named Chrome profile, blocked service workers,
disabled HTTP cache, and no detail-page prewarm.

Ether independently pinned Inception 525f3640 (jennaortegaUHD HEVC 2160p
DV/HDR10+ / DTS-HD MA 5.1). Before each run it set resume to 1390.5 s, purged only
that release's byte cache, and restarted the unchanged lab.33 binary to empty
memory caches. CDN warmth is uncontrolled. Each run sought to 900 s five seconds
after initial playable state, then measured 480 seconds.

| Metric | Wrapper | Core |
| --- | --- | --- |
| Plan received | 1.916 s | 1.782 s |
| First frame from Play | 9.715 s | 15.506 s |
| First frame after plan | 7.799 s | 13.724 s |
| Playable state from Play | 9.748 s | 17.777 s |
| Cold seek to 900 s | 3.264 s | 6.593 s |
| Startup recovery | None | Eight-second deadline, then internal direct retry |
| Drops / underruns before window | 0 / 0 | 2 / 2 |
| Measured wall time | 480.009 s | 480.007 s |
| Measured media advance | 479.970 s | 480.008 s |
| Window decoded / presented frames | 11,533 / 11,508 | 11,509 / 11,508 |
| Window added drops / underruns / underrun frames | 0 / 0 / 0 | 0 / 0 / 0 |
| Sampled buffering episodes / fallback | 0 / 0 | 0 / 0 |

Sessions were XHMBMNI6PLAZT3VQ7QYINYHU4T (Ether 005d204a) and
T6TAQD5KE5PEAIGTOLUURZSMOT (Ether a495c3ce). Both retained direct HEVC and
source/seek generations 1/2 throughout the measured window. No human lip-sync
or complete Dolby Vision enhancement-layer claim is made.

The wrapper's near-deadline first frame was accepted without the old false
startup recovery, confirming the production watchdog repair on this run.
An earlier wrapper attempt was excluded: its browser closed unexpectedly at
349.6 s. Cause was not established; no player fault is inferred. Ether stopped
that exact session, revoked its device and removed its pin before an identical
cold reset and the successful uniquely named-profile rerun.

## Source and read evidence

Ether's corrected wrapper ramp was 58.4 Mbps / 0 MB ahead at 08:02:16,
106.3 Mbps / 0 MB at :26, 94.7 Mbps / 27.8 MB at :36 and 57.0 Mbps / 53.5 MB
at :46. The following series held 27.8–134.2 MB ahead (median 83.4 MB), with
median TTFB 361–512 ms. It delivered 4,161,547,760 bytes for the session.

The core's cold probe took 1.68 s. In its first ten seconds Ether delivered only
about 13 MB, at 10.9 Mbps, with no requests waiting or source contention until
the retry: the first eight-second failure was client-paced, not a stalled
server. Retry/early-close then incurred 0.65–0.90 s cap waits. During steady
post-seek playback Ether held 54.5–120.6 MB ahead (median 87.3 MB), with
42.1–93.9 Mbps goodput tracking 39.1–94.9 Mbps consumption. It delivered
4,053,141,968 bytes for the session.

Core seek epoch 2 acquired 15,218 unique physical pages with zero repeated
page acquisitions. Its lifetime range-reader bytes were 4,037,368,800. The
bounded cache repair removes demonstrated request amplification in this window;
it does not explain or fix the separate initial client-paced decode/feed delay.

Both successful runs returned Stop 200 and revoke 200, unmounted every player,
closed their own Chrome browser and removed their temporary profile. Ether
independently confirmed zero sessions/encoders, removed the pin (204, pins [])
and released the server-change hold after the pair.

Next work is an instrumented local cold-path comparison under controlled
first-byte delay and 65-Mbps delivery. No further buffer or scheduling change
is justified by this report before that timeline is captured.
