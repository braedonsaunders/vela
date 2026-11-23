# Live TV catch-up and timeshift

Status: **built against Ether v0.3.20 spec section C**, agreed with the Ether
coordinator on 2026-11-23 (the spec lives with Ether; this note says how Vela
reads it). Verified on the web against the mock server; the real archive waits
for an IPTV provider that keeps one.

Viewers can pause, rewind and return to live on any channel whose server keeps
a rewind window, start the programme on air from its beginning, and play past
programmes from the guide when the provider archives them.

## What the server says

| Wire | Vela reads it as |
| --- | --- |
| `features.liveCatchUp.available` | some channel keeps a provider archive: replay marks, Start over, Watch from start |
| `features.liveCatchUp.timeshift.available` | live plans may carry a rewind window; read independently of `available` |
| `Channel.archiveDays`, `Programme.catchUp` / `startOver` | guide eligibility, recomputed with the clock (`programmeCatchUp`); a flag wins only while it still fits the clock |
| `PlaybackRequest { channelId, programmeId[, from: 'start'] }` | the `programme` playback target (`/watch/<programmeId>?kind=programme&channelId=…[&from=start]`) |
| plan `catchUp` (no top-level `channelId`, no `live`) | a finite programme from the archive: an ordinary timeline plus Back to live |
| plan `live.mode: 'startOver'` | a growing programme from zero, played as live, placed at its start once |
| plan `live.timeshift`, `windowStartSeconds`, `liveEdgeSeconds` | the rewind window; the edge grows in real time from the plan's arrival |
| `goLive` | adapter capability; Vela itself goes live in the engine (a live channel) or by tuning the channel (a programme from the archive) |
| `WatchTarget.programme` | Sports "Watch from start" |
| `LivePlay.at` + `score` | the score as of the delayed picture |
| C6 codes | `catchUpErrorMessage`; `timeshift_position_evicted` resumes at the window start |

## Who does what

The chrome (`packages/skin/src/widgets/player`) draws the window from
`timeshiftWindow` in `packages/core/src/live/timeshift.ts`: the engine's own
report when it has one (its edge and its position share a timeline), the plan's
otherwise. A paused engine stops reading the playlist and its edge stands
still, so the edge grows in real time from when it last moved; the engine's
"behind live" verdict stands only while its edge is fresh. Seeks are clamped
into the window, and one that reaches the edge is Back to live.

Every engine reports `snapshot.live` (`edgeSeconds`, `windowStartSeconds`,
`canCatchUp`) in the same timeline as `position`, seeks inside the live window
locally (never a server session command), takes `catchUp` to the edge less its
latency target, and keeps a live pause held:

- web: the HLS runtime's window (already so);
- Apple (Aether, iOS, tvOS, macOS desktop): the AVPlayer item's seekable ranges, or Aether's own window;
- Android (Media3): the timeline window;
- Windows and Linux desktop (mpv): the cached range mpv can seek (Start over: the plan's growing window).

Multiview tiles stay live-only: they show no timeline, and a channel change
always tunes the new channel live.

## Spoilers

Within 30 s of live the score bug shows the live score. Further behind, a feed
that times and scores its plays gives the score on screen; any other feed has
its scores hidden, with "Scores hidden while behind live" and no Reveal. The
ticker withholds the game on screen while it trails live. Other games' alerts
and ticker entries are real time.

## Is a client-side timeshift buffer worth it? No, beyond what engines keep anyway.

Ether keeps the rewind window on the server for every tuned channel (spec B1:
an hour by default, up to four, deleted when the last viewer leaves). A client
buffer would add rewind only where the server has none, and the evidence is
against building one:

- **Apple TV storage.** The segment cache is already budgeted from free space
  (`PlaybackCacheBudget`, AETHER.md "Segment cache sizing"): 40 % of free space,
  at most 2 GB, a 320 MB floor on a nearly full device, a quarter share for
  tiles. The Basement Apple TV ran out of space at 0.7–1.2 GB free. At 8 Mbit/s
  an hour of live is 3.6 GB: the floor holds about five minutes, the ceiling
  about half an hour, and only by taking the space a film's cache needs.
- **AVPlayer.** Live HLS plays on native remote HLS; AVPlayer exposes no DVR
  store to fill or seek into beyond the playlist's own window, and Aether's
  loopback route re-places the playhead after a rebuffer (AETHER.md). A buffer
  would mean proxying every live segment through a local server.
- **Media3.** Rewinding past the playlist window needs a synthetic playlist over
  a `SimpleCache`: a second HLS server inside the app.
- **Web.** MSE keeps a back buffer the browser bounds and evicts under quota
  pressure; it cannot be relied on for minutes of video.
- **Desktop (mpv).** The one cheap case: mpv's demuxer cache is bounded by bytes
  and seekable, so live uses 192 MiB ahead and 128 MiB behind (320 MiB at most):
  about five minutes of rewind at 8 Mbit/s even where the server keeps no window
  (apps/vela-desktop/NATIVE_PLAYER.md). Linux's FFmpeg cannot seek a sliding live
  playlist, so there only the cached range is reachable.

So Vela relies on the server window, lets each engine keep the back buffer it
already has (a short pause resumes from it even where the server has no window),
bounds mpv's, and adds no client DVR store.
