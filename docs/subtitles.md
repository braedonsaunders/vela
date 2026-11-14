# Subtitle components for Vela's playback core

The core supplies the source-scoped ByteReader, absolute clock, seek epoch and
isolated media surface. Subtitle modules do not own a media clock, AV controller
or duplicate byte cache. This work is under development: the following component
proof does not yet qualify embedded discovery, the complete SubtitleSession,
engine snapshots/commands or a lab title. Those remain delivery gates.

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
licensed font. The remaining local gate is actual container discovery, attached
font extraction and epoch-safe session selection/seeking; the1917 PGS lab gate
waits for the coordinator's all-clear.
