# Vela mock Ether

From repository root, put `.tools/bun-darwin-aarch64` first on PATH.
Install once: `cd mock-server && bun install`. Start from root:
`bun run mock-server/main.ts` (127.0.0.1:7777). Override `PORT` and
`DEV_ORIGIN` (default http://localhost:3000) as needed. Loopback by default; admin is unauthenticated dev tooling.

Sign in: POST `/vela/v0/auth/sign-in`, JSON
`{"idempotencyKey":"login-1","username":"demo","password":"vela","device":{"id":"vela-dev","name":"Browser","platform":"web","appVersion":"0.1"}}`.
Use returned bearer plus `X-Vela-Device-Id: vela-dev` on authenticated API calls.
Optional `VELA_MOCK_DELAY_MS=1800` delays API answers (up to 30 seconds), excluding
preflight and artwork, to inspect loading states.
Optional `VELA_MOCK_BOOTSTRAP_DELAY_MS=10000` delays only Home bootstrap (up to two minutes),
so libraries remain independently usable while inspecting the slow-Home state.
Optional `VELA_MOCK_COLLECTIONS_DELAY_MS=35000` delays only `/libraries/:id/collections`
(up to two minutes), as a large production library's collections route can, to check that
Home, Recommended and other reads never wait on it.
Optional `VELA_MOCK_LONG_HEROES=1` gives the featured titles names long enough to take two lines in the hero.
Optional `VELA_MOCK_TOKEN=dev-token` seeds that fixed bearer/device for development.
Optional `VELA_MOCK_PLEX_HOME=1` advertises Plex Home selection; after signing out, Vela's Plex
button opens mock profiles directly (the protected owner profile uses PIN `1234`).
Optional `VELA_MOCK_COLD=1` makes each title's first detail read partial (`pending: ["extras"]`,
`refreshAfterMs: 2000`, `Cache-Control: private, no-store`), as Ether answers a title it is still filling.
For device/quick-connect pairing, approve the displayed code using an already
signed-in grant. Poll every three seconds; pairing expires after ten minutes.
POST `/__admin/web-code` issues a single-use 43-character console handoff code, valid for sixty seconds.
Use `/__admin/web-code?expired=1` to exercise the expired-link page without waiting.

API and caching follow [v0](../packages/protocol/README.md). All state is in memory;
restarts invalidate credentials, cursors, receipts and sessions. The fixtures are
fictional titles and synthetic SVG artwork; no copyrighted images are fetched.
Descriptive search uses text/genre matching. AI and proactive preparation are
unavailable. Live channels use a synthetic broadcast that loops the generated
CMAF ladder with rebased decode timestamps. Its 48-second HLS window advances
every four seconds, with media sequences and programme date times and no ENDLIST.
This is a real live delivery fixture, not a connection to a television provider.

Generate media once: `bun mock-server/scripts/make-media.ts` (requires ffmpeg).
Output: `~/.scratch/tmp/vela/media/`, synthetic three-minute H.264/AAC direct MP4,
three aligned four-second fMP4 HLS qualities, two tone audio tracks and WebVTT.
The existing remux/transcode Quality URLs remain complete muxed A/V playlists.
Native HLS master includes alternate audio groups. Generated files are scratch;
regenerate if aged out. Plan and media remain unavailable until generation finishes.
Movie metadata describes fictional full-length titles; all playback is explicitly
this three-minute test fixture. Remux copies the original 720p video; transcode
alternatives are generated offline. No actual on-demand encoder scheduler exists.

Scrub thumbnails: `bun mock-server/scripts/make-trickplay.ts` (after make-media) writes two
10×10 sheets of 320×180 counter stills, one per second, each showing its own second, under
`trickplay/320/`. Fixture plans then carry `trickplay` and
`GET /vela/v0/sessions/:id/trickplay/320/:sheet.jpg` serves them to the owning session
(`private, no-cache`, ETag, 304, `X-Ether-Trickplay-Fallback: false`).

For existing media, `bun mock-server/scripts/make-media.ts --mse-only` adds
video-only `video360/`, `video540/`, `video720/`, `mse-master.m3u8` and a local
`mse.json` descriptor without overwriting any existing native/muxed/audio files.
Full generation also creates these resources. Generation refuses to overwrite an
existing MSE fixture; stop players before removing/replacing any generated files.
After the descriptor is written, MSE-capable VOD clients additionally receive
`transcode-mse`. Its Quality has `audioGroupId: fixture-audio` and no audioCodec;
audioRenditions supplies the two existing audio-only AAC media playlists with
`audio/mp4; codecs="mp4a.40.2"`. Video is copied from the matching muxed rendition,
retaining four-second keyframes and its decode clock; audio retains the original
AAC frame/encoder timing. Both tracks use the same three-minute source timeline.
Choose this separate path explicitly when driving the alternate-audio pipeline;
direct/native/muxed paths and live remain unchanged. The descriptor is local build
metadata, not an unauthenticated HTTP resource. Media resources use session grants
and the same fault injection as muxed segments.

`bun mock-server/scripts/make-media.ts --ts-only` adds `ts360/`, `ts540/`,
`ts720/` and `ts-master.m3u8` for native MPEG-TS HLS qualification (full generation
also creates them). It remuxes the existing English muxed variants, refuses to
overwrite TS outputs, and leaves all fMP4/native/audio files alone. These resources
are served through the same session media grant; `.ts` uses video/mp2t and receives
segment fault injection. A manual native-only path can use the TS master with
qualities=[]; TS is not offered to the fMP4 MSE pipeline or added to normal plans.

GET/POST `/__admin/faults` reads/patches:

```json
{"rangeFailSeconds":0,"bandwidthBps":0,"failEvery":0,"truncateEvery":0,"stallMs":0,"fallbackUnavailable":false,"capacityExhausted":false}
```

Zero disables each numeric fault. Bandwidth applies per response (bits/s).
failEvery/truncateEvery affect every Nth requested CMAF media segment globally;
failed segments return 502; truncated bodies abort after half the advertised bytes.
stallMs delays first media bytes (capped sixty seconds). Query overrides of the
four numeric fields also work on media URLs. Faults snapshot per request.
Capacity blocks new playback and transcode switch attempts. Unavailable fallback
removes transcode offers from new plans and rejects switches on existing plans.
These are controlled faults, not a production resource or network simulator.
Per-session codec verification is opt-in on playback creation:
`POST /vela/v0/playback?pendingCodecs=true` with the normal VOD MSE client body
selects the muxed `transcode` path. Add `pendingCodecPath=transcode-mse` to select
the generated separate-audio path instead. Every transcode quality starts with
codecStatus=pending, empty videoCodec and absent audioCodec. A successful full
GET of that quality's init.mp4 schedules its actual fixture codecs for250ms later,
publishing a newer plan/SSE revision with the same source/seek generations, quality
ID and URL. Other rungs remain pending. Separate video retains absent audioCodec;
its audio-only rendition MIME remains authoritative. HEAD, playlist reads, failed
init requests and audio init reads do not verify video qualities. The update is
discarded after generation changes, stop, grant revocation or expiry.
Use `pendingCodecs=never` to leave codecs pending after init for the client timeout
drive. Each new mode/session needs a fresh idempotency key. Default sessions are
unchanged; no global admin switch or dev restart is required to change modes.
Reset by POSTing the all-zero/false object. Media uses the broker path
`/sessions/media/<session>/<token>/...` with byte ranges and session grants.

Only routine check: `cd mock-server && bun x tsc --noEmit`.

Authenticated `GET /vela/v0/libraries` lists the fixture's five published views
in server order; `/libraries/:id/items` supplies scoped, receipted grid pages with
advertised sort/filter options (movies, shows, documentaries, live, mixed).
Unsupported filters/sorts fail400, changed query/snapshot cursors fail409, and
unknown library IDs fail404. These demo views are all visible to the demo viewer.
Production visibility remains Ether's responsibility; no hidden production
library rules or IDs are simulated as authoritative data.

Trailer-preview fixture: features.trailerPreview is available and alternating home
rows opt into previewOnFocus. POST /vela/v0/titles/:id/trailer-preview with normal
{idempotencyKey,client} first returns preparing/retryAfterSeconds=1 for movies and
shows; after a second, a fresh-key request returns a60-second preview grant if
direct.mp4 exists and MP4/H.264/AAC is accepted. This is synthetic generated media,
not the title's real trailer. Missing media/incompatible codecs/episode or season
targets return unavailable with a reason. No timer or playback session is created
while preparing. One preview per viewer, replacement revokes the previous grant,
and /sessions/:id/commands kind=stop uses the grant generations. Preview media is
scoped to direct.mp4; expiry/revocation/stop reject further reads. Preview sessions
live in a separate store and never touch normal sessions, watch state or receipts.
Bootstrap now supplies no eagerly-created normal-session preview; hero previews
use this same on-demand endpoint. No media regeneration is needed.

Home bootstrap starts with two rows of twenty entries. Its nextCursor continues
the ordered row list through GET/rows?placement=home; each row's own nextCursor
continues only that row through GET/rows/:id. Subsequent default pages remain
two rows/twenty entries (explicit limits1–100 are accepted). Cursors bind the grant,
viewer policy, featured exclusion set and fixture snapshot, keep their original
one-hour expiry, and reject cross-row/query/snapshot reuse with409. Receipts and
IDs remain stable across pages; featured titles stay excluded. This deliberately
first page exercises both vertical and horizontal home scroll loading. Additional
fictional titles have real detail/library entries, so the continuation does not
depend on repeated cards. Home item cursors bind snapshot/offset, not page size:
an explicit limit20 continuation is valid even for a cursor issued at another size.

The guide fixture has170 channels, six favourites,80% logos, and25% without
listings. Programmes follow fixed channel-seeded schedules with15–120min slots,
two channels with gaps, varied episode metadata/artwork and explicit fixture
genres. IDs and programme facts remain stable across overlapping guide windows.

Set `VELA_MOCK_SEASONS=50` to expose a long named season list on Meridian Station
for title-page selector checks.
Set `VELA_MOCK_RAW_RATING=1` to return the first movie's rating as `gb/U` for
title-page rating normalization checks.
The existing24h window cap and100-item maximum pages still apply.

Initial API track selection and in-session track mutation are advertised unavailable
in this mock: native HLS alternate-audio selection and the external WebVTT are
real, but the mock cannot reconfigure an active muxed MSE source. Unsupported track
commands return policy/feature_unavailable rather than only changing metadata.
SSE replacement, revocation, session end and disconnect release heartbeat timers;
streams also close when their bearer grant expires.

Live-specific faults are independent of VOD: GET/POST `/__admin/live-faults`
accepts `{"gapEvery":0,"delayEvery":0,"delayMs":8000}`. Every Nth broadcast
sequence is marked EXT-X-GAP (and returns 410), or delays segment delivery. Zero
disables each interval; delay is capped at sixty seconds. Reset both intervals
to zero after a drive. All channels share the synthetic broadcast clock. Live
offers English muxed audio only; VOD retains the alternate track fixture.

For original-file decoder qualification, opt in with
`bun mock-server/scripts/make-universal-avc.ts`. It adds only
`~/.scratch/tmp/vela/media/universal-avc.mp4`:8s,640×360/24fps H.264 High,
AAC48kHz stereo, explicit BT.709 primaries/transfer/matrix and limited range.
The generator probes those actual encoded fields before exclusive publication
and preserves any existing file. Existing broker media grants may serve that
allowlisted filename; normal playback plans/media are unchanged.

### Format matrix

`bun mock-server/scripts/make-format-matrix.ts` writes thirty-second originals to
`~/.scratch/tmp/vela/formats` (`VELA_MOCK_FORMATS_ROOT` moves it): H.264, HEVC Main10 HDR10 and
HLG, Dolby Vision 8.1 (MKV and `dvh1` MP4), 8.4 and 5, AV1 8-bit and 10-bit HDR10, VP9 profiles 0
and 2, MPEG-2, MPEG-4 Part 2 and 4K HEVC, with AAC, AC-3, E-AC-3, TrueHD, DTS, FLAC (7.1 at 96 kHz,
stereo at 192 kHz), ALAC 24/96, Opus 7.1, Vorbis and 7.1 PCM. Every multichannel track plays a
different tone per channel (`CHANNEL_TONES`), so a probe can name each output channel. It needs
ffmpeg with libx265, libsvtav1 and libvpx-vp9, and `dovi_tool` (`DOVI_TOOL=<path>`).

POST `/__admin/original` `{"name":"hevc-dv81-truehd-5.1.mkv"}` makes every later movie or episode
session lead with that file as an `original` direct path (`{"name":null}` stops). The mock probes
it with ffprobe, as Ether does, for the path's `originalVideo` and the plan's audio and embedded
subtitle tracks; the synthetic remux/transcode paths stay behind it as the fallback. An optional
`"video": {…}` overrides probed `originalVideo` facts (a Dolby Vision profile ffprobe cannot see in a
raw-muxed file), and `"selectSubtitle": true` selects the first embedded subtitle track.

Dense live-guide fixtures are opt-in. From the repository root, run:

```sh
VELA_MOCK_GUIDE_SCALE=1000 VELA_MOCK_GUIDE_WINDOW=1 bun mock-server/main.ts
# Use VELA_MOCK_GUIDE_SCALE=10000 for the larger lineup.
```

Programmes last 5–20 minutes and are generated only for requested channels and
windows. `VELA_MOCK_GUIDE_WINDOW=1` advertises the optional complete-window API;
omit it to verify paginated fallback. `VELA_MOCK_GUIDE_UNAVAILABLE=scale-5`
simulates a retryable guide outage, distinct from a ready channel with no listings.
`VELA_MOCK_DOWN_CHANNELS=<id or number,…>` refuses those channels' playback as
final (503 `source`/`network`, retry not allowed), like a lab tuner whose provider is down.
For a TV on the LAN, set `VELA_MOCK_HOST` to this machine's LAN address; the
default remains loopback. Sign in with the mock's `demo` / `vela` account.
`VELA_MOCK_GUIDE_GAPS=scale-1` adds a long empty interval around the current
hour on that channel to verify that vertical focus retains time across gaps.

`rangeFailSeconds` fails byte-range requests with HTTP 503 for N seconds from
the first media request after the setting changes. Set it to zero and make a
media request before rearming the same duration. Non-range requests continue.

Music, books and audiobooks ([media kinds](../docs/media-kinds.md)): the `music`, `books`
and `audiobooks` libraries (fixtures in `packages/protocol/fixtures/media.ts`, all fictional)
carry `Library.media` and `Title.media`, list their root level by default and one level per
`tab` with a `level` (Albums, Tracks, All books, Series). Artists, albums, series and
multi-part audiobooks page their children (tracks by disc then index); Home gains
"Recently added albums", "Continue reading" and "Continue listening" after its first two
rows, and artist pages get a `:top` detail row. Tracks, audiobooks and parts play through
`POST /playback` as `media: 'audio'` plans with one direct, range-capable file; books open
with `POST /titles/:id/read` (a fifteen-minute `/reading/media/<token>/<file>` URL, no bearer,
byte ranges) and save `POST /titles/:id/reading-progress`, which returns per viewer as
`WatchState.reading` (`fraction >= 0.98` marks played; `watch {played:false}` clears it).
Covers, book jackets and portraits are original SVG from `covers.ts`. `VELA_MOCK_OLD=1` and
`VELA_MOCK_LAB=1` omit these libraries and the `mediaClasses`/`reading`/`audioPlayback` flags.

Generate their media once (scratch, not committed; files are served 503 until present):
`bun mock-server/scripts/make-music-media.ts` synthesizes six original clips (AAC, MP3,
FLAC) and a chaptered spoken-word stand-in per audiobook file into
`~/.scratch/tmp/vela/media-music/` (needs ffmpeg; about 30 seconds), and checks each file's
duration against the fixture. `bun mock-server/scripts/make-book-media.ts` writes the EPUB 3
books, the PDF field guide and the CBZ comic into `~/.scratch/tmp/vela/media-books/` without
dependencies. Both take an output directory argument; `VELA_MOCK_MUSIC_ROOT` and
`VELA_MOCK_BOOKS_ROOT` point the mock (and the scripts' defaults) elsewhere.
