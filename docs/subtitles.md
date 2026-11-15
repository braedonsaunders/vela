# Subtitle components for Vela's playback core

The core supplies the source-scoped ByteReader, absolute clock, seek epoch and
isolated media surface. Subtitle modules do not own a media clock, AV controller
or duplicate byte cache. The borrowed-reader SubtitleSession and its local container/renderer proof are
implemented. Engine snapshot/command integration and the lab title remain
delivery gates; the core host owns those integration points.

## Implemented components

- `text.ts`: bounded SRT/WebVTT parsing, safe inline bold/italic/underline/colour,
  cue position/line/size/alignment and an overlap-aware cue index. No HTML is
  inserted into the document. WebVTT regions, rolling captions and arbitrary cue
  CSS are not implemented by this plain text path.
- `pgs.ts`: PGS/SUP segments, palette/object continuation and epoch state,
  composition/crop, RLE bitmaps and clear display sets. SD palettes use BT.601;
  HD palettes use BT.709. Missing acquisition data yields no partial display;
  the session must acquire a complete set or report seek unavailable.
- `canvas.ts`: text with size/background/colour/position preferences and PGS
  composition scaled from subtitle video resolution. One visible overlay canvas.
- `ass.ts`: real libass styling/shaping through independently loaded JASSUB1.8.8,
  pinned at `ca27d60a672612b2b8a80d0728092c2164e32a07`. No COOP/COEP or video-element
  clock is needed. The host supplies each render time. A pinned canvas-only
  resize compatibility bridge supplies `_videoWidth/_videoHeight`. Retiring a
  selection destroys its worker and canvas so stale pixels cannot reach its successor.
- `preferences.ts`: validated per-device appearance values agreed with the CC
  menu: subtitleSize small/medium/large/xl, subtitleBackground none/shadow/box,
  subtitleColor white/yellow, subtitlePosition bottom/raised. Raised captions use
  a host-provided controls inset. Time offset is separately bounded to ten minutes.

## Distribution

`assets.json` records exact sizes, hashes, source revisions and package identity.
`install.ts <destination> --from=<prepared-directory>` verifies every executable,
font, licence and source archive before copying a source-complete distribution.
Asset key: `36f3166bb40db112`. Preparation input currently lives in the ignored
internal audio worktree at `.exact/subtitle-prepared`; no binaries are checked in.
The release packager must call this installer and preserve its complete output.

JASSUB's wrapper is MIT; its dependency notices are not replaced by that licence.
The distribution includes the release's full COPYRIGHT file: libass ISC, FriBidi
LGPL-2.1-or-later, FreeType FTL (elected), HarfBuzz MIT/NTP and Brotli MIT, with the
additional notices those projects carry. Exact JASSUB and compiled dependency
source archives, including build/patch scripts, are distributed alongside the
replaceable WASM. Unused Fontconfig/Expat targets are disabled in this release's
Makefile. Noto Sans is distributed separately with its SIL OFL1.1 text and author
notice; no media-supplied font is included in the application distribution.

The runtime verifies JS, worker, WASM and fallback-font bytes before use. The
worker executes verified blob URLs, font URLs are not guessed from ASS names,
and local font enumeration is disabled. Libass bitmap/glyph caches are bounded
to64/16MiB; attachment/document limits remain separate. Only enabled subtitles
load rendering assets. The single-threaded package avoids adding isolation
requirements to the rest of playback.

## Local component evidence

One dedicated local Chrome drive used generated ASS with Noto Sans, without
cross-origin isolation. At2s the white italic cue painted2005 nontransparent
pixels; at5s the authored yellow sign painted3970 pixels (828 yellow), entirely
within the upper130 video pixels. At8s the canvas cleared to0 pixels. Screenshots
were inspected. One visible canvas and no renderer errors remained.

The generated PGS/SUP fixture produced display/clear events at1/3/4/7s. Its220x32
bitmap painted exactly3168 opaque glyph-bar pixels, then cleared to0. Styled,
positioned VTT painted6315 pixels in the same local drive. Primitives type-checked
and bundled; the offline source-complete installer passed all hashes. The first
ASS attempt exposed the pinned resize issue and incorrect interpretation of the
glyph cache limit units; both were corrected before the successful drive.

The dedicated Chrome, worker and owned8795 server were closed afterward. No lab,
provider requests or private source capture was involved. Use `fixtures.py` to
regenerate SRT/VTT/ASS/SUP and optional MKV/tx3g files from a generated video and
licensed font. The complete local session evidence below adds container discovery, attachment
extraction and epoch-safe selection/seeking. The1917 PGS lab gate waits for the
coordinator's all-clear.

## Borrowed-reader session

`session.ts` exports `SubtitleSession`. The host dynamically imports this module
when subtitles are enabled. Construction accepts `surface`, `reader?: ByteReader`,
`source: SubtitleSource`, `epoch`, `clock: () => number` (absolute title seconds),
`assetBaseURL`, `describedTracks?`, `signal`, `getViewport?`, `onTracks?`,
`onState?` and `onFailure?`. The surface must be positioned and isolated inside
the media layer. `getViewport` returns CSS-pixel `x/y/width/height/bottomInset`
for the actual displayed video, including any letterboxing. Rendering is capped
at4096x2160 and device pixel ratio2. No subtitle URL or time rebasing comes from
the HLS video element.

- `discover(): Promise<readonly SubtitleTrack[]>` publishes actual container
  identities. MKV `TrackNumber` and MP4 `track_ID` remain exact; `streamIndex`
  counts every TrackEntry/trak, including AV and unrecognized tracks. A unique
  matching described full-container index can alias the server track ID;
  `serverId` is retained separately for an authorized server fallback.
- `select(id | null): Promise<void>` prepares a fresh selection, exposing
  `pending`, `selected` and `error`. `onState` tells the host to resnapshot.
  Preparation errors publish `onFailure({trackId,serverId,code,message})` and leave
  the overlay Off. The host owns any server burn-in command. Nothing changes AV.
- `seek(positionSeconds, epoch): Promise<void>` clears immediately and reacquires
  at the supplied position, including paused seeks. Older epochs are refused.
  The host changes the clock to that same target. Epochs are local playback
  epochs, separate from the source/wire generation fields.
- `setPreferences(preferences | "name=value")` uses the UI's persisted device
  preferences. ASS preserves authored styling; appearance options affect plain
  text. PGS preserves authored pixels. `dispose()` aborts operations, destroys
  the ASS worker, removes its canvas and forgets document/font caches.

`matroska.ts` and `mp4.ts` parse subtitles directly over the borrowed core reader;
no Mediabunny AV numbering is used. Disposal never disposes the reader. Metadata
and cue operations have8s deadlines,48MiB requested-byte limits,64MiB maximum
source-page coverage and bounded record/packet counts. Fonts are read only for
ASS selection, at most8MiB each/32MiB total. Text/ASS windows retain at most8192
packets/16MiB. Only the current PGS composition is decoded to RGBA; future packets
stay compressed. Window/crop geometry is intersected with the composition plane.

Long cues require complete acquisition history. MKV Cues are useful seek hints
but do not prove that every earlier text event was indexed. A scan from the
beginning or overlapping continuation proves text history; otherwise the module
reports exact seek unavailable. It does not silently omit a possible long cue.
PGS can establish its current state from a complete display/clear acquisition set
before the target, retaining palettes and fragmented objects within a window.
Distant seeks lacking such a bounded acquisition fall back through the host.
Compressed/encrypted/laced MKV subtitle packets and nonstandard per-track time
transforms are reported unavailable. MP4 tx3g/wvtt uses actual sample tables,
composition offsets, language and title edit-list mapping. Non-unit edit rates,
multiple sample descriptions and fragment-only subtitle indexing are explicitly
unsupported; they require the server path.

External files must use an authorized same-origin HTTP URL; redirects are
rejected and document reads are size/deadline bounded. `webvtt-window` preserves
all grant query fields, sets `ether_window=1`, and replaces only `from_ms` with
absolute title milliseconds. It polls the covering120s window every second,
prefetches its successor in the last20s, merges/deduplicates cues and discards
expired history.503 retries while selected.200 empty is provisional, with no
invented completeness or EOF. Epoch/selection disposal cancels late replies.
This matches lab.15's supplied server contract; the local check simulates that
contract and does not claim a live server qualification.

## Complete local session evidence

One Chrome drive over core RangeReader and generated files rendered MKV SRT,
ASS with its2,049,096-byte Noto attachment, PGS and MP4 tx3g. Full stream index2
and actual container ID3 were preserved, while an intentionally mismatched
server language did not replace actual `eng`. At2s the overlays painted
5795/2005/3168/6481 alpha pixels respectively. Paused seek4.5s painted the next
cue (ASS3970 pixels including899 yellow; PGS3168); seek8s cleared each to zero.
Each selection had one visible canvas; Off and disposal left zero. A retired
pending selection did not restore its canvas. The borrowed-reader disposal count
was zero and no session failures were recorded. Progressive VTT recovered from
503, empty200, then populated200 and painted2574 pixels including901 yellow.

A separate indexed wvtt fixture within that same local browser exercised an empty
initial edit and absolute cue mapping; its4.5s positioned yellow cue painted2671
pixels (988 yellow). The attached-font ASS session screenshot was inspected. The
owned Chrome and8795 server were closed afterward. No lab/provider access or
private media capture occurred. Engine snapshot/commands integration and the
1917 PGS lab qualification remain outstanding; lab access is held for the
coordinator's restart clearance.
