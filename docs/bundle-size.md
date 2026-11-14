# Web bundle investigation

Measured release 0.1.19, source `b6a7c92`. Sizes below are bytes, with gzip at
level9 for repeatable comparisons. No source-map/debug payload is shipped.

| Payload | Entry contribution | Separate static files |
|---|---:|---:|
| app.js | 27,743,543 (2,602,634 gzip) | — |
| Preview JPEGs, five skins | 0 image bytes | 275,660 |
| Four font files | 0 font bytes | 379,948 |
| Grain and Mochi dots SVG assets | 0 image bytes | 655 |
| Static data-URI SVG placeholders,321 occurrences | 27,927 | — |
| English message catalog,341 entries | 13,662 compiled | 15,028 source JSON |
| All SVG path literals (icons/illustrations),23,641 occurrences | 1,043,946 | — |
| All string/template token payloads | 7,419,138 | — |

The rows overlap: SVG paths, placeholders and the catalog are string payloads.
There are no base64 images/fonts in the entry. The remaining approximately20MB
is generated executable syntax rather than bitmap/font payload. The complete
tar.gz is4,413,979 bytes; that is not the entry's gzip size.

Tokenization with the already-installed Acorn parser identifies substantial
duplication: the478-byte animation-name list occurs2,093 times (1,000,454 bytes),
data-exact-f occurs58,869 times (824,160 bytes), the heart path1,084 times
(98,644 bytes), and the palette path542 times (61,788 bytes). Preview JPEG URLs
are repeated154 times each, but the image bytes are external. Runtime paint
attributes are required semantics, not debug metadata to strip.

The UI lead measured the compiled plan with its source/call-site map:

| Source | Plan nodes | Main contributor |
|---|---:|---|
| Jelly Twin | 36,602 | Icon:32,520 |
| Mochi | 13,400 | Mascot:5,610; PixelIcon:1,212; Loader:544; Hopper:450 |
| Cinematic | 6,787 | — |
| Index | 1,402 | — |
| Example | 334 | — |
| Foundation | 341 | — |
| Root | 81 | — |
| Total | 58,947 | — |

These are exact node counts, not invented per-source byte allocations: minifying
and shared runtime deduplication prevent treating a node share as a byte ledger.
An isolated cinematic-only export of the same source and shared foundation is
2,060,607 raw /281,569 gzip bytes. Other profile measurements were paused when
the owner chose the smaller source fix: convert repeated icon/mascot subtrees to
SVG assets rendered as one image/symbol node. Re-measure the all-skins result
after those skin-owner changes land before deciding on release profiles.

Packaging now content-addresses external image/font files and extracts complete
static image/font data-URI literals into hashed files. Dynamic symbol/mask code
is preserved, as are canonical ESM module URLs. Applying this to an isolated
0.1.19 copy yields27,746,225 raw /2,558,999 gzip entry bytes: only43,635 gzip bytes
saved, and a small raw increase from hash URLs. It does not fix the main cost or
meet the initial <1MB gzip target by itself. Type-check and JS compile/parse passed.

Exact at the pinned revision has no supported per-Contract-import lazy boundary.
If asset conversion is insufficient, supported static single-engine exports can
be delivered as separate entry builds with a small selector and full navigation;
genuine one-plan on-demand skin imports require an Exact feature. The owner has
paused any new loader/multi-engine artifact architecture pending re-measurement.
