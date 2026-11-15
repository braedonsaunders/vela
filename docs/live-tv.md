# Live TV qualification

Live guide and engine integration use the same skinnable player as movie
playback. Detailed engine measurements and earlier server fixes are in
[playback-engine.md](playback-engine.md).

## CHROMA 80: one authorized lab attempt

Target: installed Vela 0.1.8, Ether 0.3.11-lab.4, real Chrome through
playwright-cli, viewer `vela-test`, 2026-11-14 UTC. One stream, no fault injection.

| Step | Evidence / result |
| --- | --- |
| Normal guide entry | CHROMA 80, number 1980, `Watch CHROMA 80`. Current authorized lineup paged 100 / more + cursor, then 18 / exhausted. |
| Single tune | Playback HTTP 200; `showcase-chroma-80`; session `LHWIHS43Y22HBSDLVWW6WZ2BY7`; ready adaptive HLS remux; title `CHROMA 80 · Big`. |
| Initial decode | Four frames after 20,419 ms; readyState 4, paused false, time 0.012943. Chrome still displayed a demux error, so this is not sustained-play proof. |
| Real programme picture | **Not verified**: browser context reset before visual inspection. No claim of content success or a deprecation slate. |
| Playing observation HTTP 200 | **Not verified**; Ether asked for read-only correlation of this session. |
| Requested 0.1.8 screenshot | `client/.exact/lab-25-live-chroma80.png` **not produced**. No substitute image. |
| Close / stop / sign-out | **Not verified** because the tab reset to `about:blank`; dedicated Chrome was then closed. Ether asked to confirm stop/expiration or clean up only this session. |

The CLI daemon error log was empty; the reset cause is unknown. No second tune
was attempted under the coordinator's explicit one-attempt instruction. A retry
requires coordinator clearance after the tooling interruption is addressed.

Ether's read-only correlation found the sole matching tune's resources released
at 04:36:18.941 UTC (age 53.613 seconds, media delivered and viewer reservation
released) and the channel broadcast stopped at 04:37:18.962 UTC. No cleanup
mutation was needed for those resources. This is cleanup evidence, **not** proof
of a playing observation or HTTP stop 200. The coordinator is correlating the
public broker-session state separately.

## Other live evidence

Earlier real guide pagination and live transport/stop checks passed. BBC News
decoded a Pluto device-unavailable slate, so BBC programme content remains a
failure despite successful transport and decoded frames. That upstream finding
does not establish the content outcome for CHROMA 80.

## Automatic latency and preview lifetime

Latency is engine policy. A viewer does not select low-delay/adaptive modes.
Ether's optional `livePolicy` supplies an owner preference (`auto`, `low`, or
`stable`) and a preferred target in seconds, not a minimum. Omission means auto.
The engine starts with an adaptive cushion, tightens only after sustained buffer
and transfer headroom, and backs off after a stall or network retry. A small
catch-up rate applies only while playing with enough real buffer. Jump to Live
uses the current target and the published/seekable window. Native HLS retains
browser-managed loading; Vela controls catch-up and the explicit live target.
The core's moving-live demux path remains a separate migration gate.

UI lead's installed 0.1.33/lab.18 guide check tuned one preview, then navigating
Home sent the session's Stop command and received HTTP 200. No later request
used that session, and the dedicated browser was closed. The pending foundation
change additionally holds full watch until the preview's Stop reply is confirmed;
a timeout is not treated as successful release. Stop failures have bounded
retries and a visible retry action. This one Home-transition proof does not
stand in for a measured tab-hide or full-watch-transition check.
