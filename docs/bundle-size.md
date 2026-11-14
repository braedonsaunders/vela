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

## 0.1.21 after icon conversion

Clean source `824f6df`: **22,522,116 raw / 2,002,817 gzip9 bytes**.
The plan has19,885 nodes (-66.3%); entry gzip fell23.0%. This misses the1MB target.

Acorn AST byte ranges identify **22,203,750 bytes (98.6%)** in the generated
Contract application function. The remaining318,366 bytes contain Exact runtime,
TypeScript data code, catalogs and boot. Only `en.json` exists in this snapshot:
Contract text table11,767 bytes and TypeScript catalog14,168 bytes (overlapping
that runtime/data remainder and generated initialization). No base64 or font data
URIs occur. Two generic image-data URI strings remain in the runtime. The shared
symbol registration is under9,390 bytes; image/font bytes remain external.
Marquee is absent from this snapshot dispatch, map and entry (zero name references).

The following is a **section ledger**, not minifier-source-map precision. All19,885
creation sites match emitted node IDs; the source plan differs by nine root nodes
removed in the mounted release. Final minified bytes from each creation site to the
next are attributed to that site’s source, including following bindings/closures.
Nested parent calls are matched by tag/class with bounded local reordering; all
sites matched without global fallback. Shared control-flow punctuation follows the
preceding site. Sections do not overlap and sum to the exact entry size.

| Largest section source | Bytes |
|---|---:|
| skins/cinematic/slots.contract | 3,730,690 |
| skins/jellytwin/slots.contract | 3,146,361 |
| skins/mochi/slots.contract | 3,099,156 |
| skins/cinematic/auth.contract | 2,179,962 |
| skins/mochi/look.contract | 1,983,232 |
| skins/mochi/auth.contract | 1,416,215 |
| skins/jellytwin/look.contract | 1,132,846 |
| skins/mochi/guide.contract | 713,867 |
| skins/cinematic/guide.contract | 677,368 |
| foundation/skin-picker.contract | 639,689 |
| generated initialization/actions/resources | 594,648 |
| skins/jellytwin/auth.contract | 590,934 |
| Exact runtime + TypeScript + catalogs + boot | 318,366 |
| skins/mochi/library.contract | 314,787 |
| skins/jellytwin/guide.contract | 234,564 |

Aggregating the same sections: Cinematic7,236,134; Mochi7,762,509; Jelly Twin5,326,440;
Index384,439; Example92,956; initialization594,648; shared/foundation/root/runtime
1,124,990 bytes. These totals identify generated UI code, not embedded artwork, as
the remaining payload. The owner approved separate static engine builds and a
tiny selector; Exact-supported static dispatch is used, without vendor changes or
unsupported lazy Contract imports. Cold-load measurements remain pending that build.
