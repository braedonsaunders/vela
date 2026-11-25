# Round-seven scene candidate

[Round-seven patch](round-seven.patch) reproduces the owner's 18-scene review page from the measured framework tree `aefedbb75e82ed10cca337678dca559cfcd44c05`. Apply it directly to that tree in a disposable checkout. The patch includes the earlier curation changes.

```sh
patch=packages/visualizer/spike/candidates/round-seven.patch
shasum -a 256 "$patch"
git apply --check "$patch"
git apply "$patch"
(
  cd packages/visualizer/framework
  { cat 00_head.html; cat [1-9]*.js; printf '</script>\n</body>\n</html>\n'; } | shasum -a 256
)
```

| Artifact | Size in bytes | SHA-256 |
| --- | ---: | --- |
| Patch | 139,363 | `f002228153622ad8a8c1b892d00fae030ffab363a15eff0fe24d26b79362b62b` |
| Reassembled index.html | 253,130 raw, 103,673 gzip | `789f7c6aa5f43ecb8271c7c6ba556b6bd40767526a8e23e848449951f4d11a5b` |

Exactly six scene sources differ from round six. Shallows, Wind in the Wheat, Watercolour, Incense and Ink in Water revise their response to music. Neon Cartography adds river lines, settlements and a closer view. Its final fragment shader smooths coastlines by weighting per-country coverage and tones down the river glow. Falling Leaves retains the [round-six digest](round-six.md).

A recording WebGL host exercised all 18 scene initializers and captured 57 program pairs. All 114 GLSL ES 3.00 stages validated. The Apple shader tool emitted MSL and reflection for all 57 pairs, including both vertex orientations. Nine program pairs changed since round six, containing ten distinct new shader stages.

## Measured response to sound

The author's fixed-clock A/B probe played a 100 ms sine burst through an offline Web Audio analyser and compared the resulting frame with a silent control. The table gives the percentage of sampled pixels whose largest RGB channel difference reached 10 of 255 at the sixth render tick, approximately 100 ms. Each capture used a 400 × 250 viewport sampled at 100 × 62 pixels. All pre-burst control differences were zero. The three scenes with paired logs were identical in the preliminary and final round-seven sources.

| Scene | 82 Hz, R6 → R7 | 780 Hz, R6 → R7 | 7,200 Hz, R6 → R7 |
| --- | ---: | ---: | ---: |
| Shallows | 37.8% → 71.8% | 0.1% → 30.0% | 2.1% → 14.5% |
| Wind in the Wheat | 60.0% → 64.4% | 0.0% → 18.1% | 1.9% → 3.6% |
| Watercolour | 4.0% → 37.7% | 2.7% → 2.7% | 0.0% → 0.4% |

In the author's separate muted music run, the six revised scenes each advanced 4.50–4.51 seconds, reported 269–270 frames and detected 9–15 beats per sample. That run preceded the final Cartography fragment adjustment.

## Geography provenance

The [preserved authoring script](round-seven/map.py), originally `round7-work/map.py`, selects 187 river features of scale rank 4 or better from 462 Natural Earth 1:50m features. It simplifies each polyline with a 0.09-degree tolerance, quantizes to eighths of a degree and delta-encodes the coordinates. It appends 1,251 settlement positions from the Natural Earth populated places source used in round six. Running the packer against the frozen inputs reproduced the embedded 15,304-byte base64 payload. The author subsequently refined only the map fragment shader with per-country coverage and lower river glow. The candidate patch incorporates that post-packer edit. At runtime the scene reads river coverage and settlement markers from a 1440 × 720 two-channel texture.

| Authoring input | SHA-256 |
| --- | --- |
| map.py | `77c22085d96ad0893921a4458255ae703c899a0381a8a8f2b0d018e9f3d5d374` |
| river50.json | `f286e0ce978fde999ca2d7a78c764be08542e19b63cded52b05c12d5173ccc51` |
| cities.json | `8e70756b39fae9bcdc1e332bfc510c024c5edd3a13203ffd20092ee37b61d978` |

## Native verification

The final 18-scene bundle used the same linker inputs on both executors. GLES linked all 57 program pairs. The M4 Pro compiled all 171 Metal stage variants and resolved their entry points. Both executors rendered the six changed scenes with decoded music and silent output. The Metal captures used 120 frames at 1920 × 1080 per scene. [Metal scene captures](round-seven-metal-sheet.jpg)

| Map uniform | GL unit | Metal fragment texture slot | Uploaded data and sampler |
| --- | ---: | ---: | --- |
| uMap | 3 | 1 | 2880 × 1440 R8 country IDs, nearest |
| uHydro | 5 | 2 | 1440 × 720 RG8 river coverage and settlement locations, linear |
| uText | 4 | 3 | 1408 × 1848 R8 city labels, trilinear |

The two geographic textures wrap in longitude and clamp in latitude. GLES uploads matched the authoring rasters byte for byte, including all 2,073,600 hydro bytes. The 523-city label atlas is shared with round six. In a Metal A/B at the same clock time and random seed, removing the river channel changed 107,401 screen pixels, removing settlement locations changed 74,717, and removing both changed 175,039. The affected pixels overlap.

| Final artifact | Bytes | Gzip bytes |
| --- | ---: | ---: |
| Browser review page | 253,130 | 103,673 |
| Native JS with all scenes and baked textures | 2,161,862 | 549,657 |
| Metal shader and reflection table | 1,313,027 | 155,059 |

Use the native packager's `--framework` argument to build from this candidate in an isolated checkout. The shader table size measures the spike's MSL source and reflection JSON. Device packages would also include host binaries.

## Closer camera revision

Apply [the camera patch](regional-zoom.patch) after the round-seven patch. The map's vertical span now varies from 3.5° at a tour stop to 5.5° in the middle of a leg, four times closer than the previous 14°–22° range. Tour progress advances at 0.005 per travel unit to keep landmarks moving across the closer view at the previous apparent speed. The resulting 253,131-byte standalone page has SHA-256 `635ca4b9ba1ad9ca9a0bd4372c210e7ccbb56fcdf15688e8fe263feacbe640d2`. Muted WebGL2 verification checked both endpoint and mid-leg spans using the actual shader uniforms.

## Regional linework and town labels

Apply [the detail patch](regional-detail.patch) after the closer camera patch. The standalone is 320,697 bytes (150,722 gzip), SHA-256 `6a433db816d9505815054832fa8a054737b33f1e1377f289a04274db063e6b7c`. It retains the 3.5°–5.5° framing and all 17 other scenes. The map clamps negative startup travel to zero so an initial browser animation timestamp earlier than setup cannot select a negative tour index.

The map draws nearby river and boundary segments as antialiased lines. The authoring page stores the simplified river paths once as delta-coded coordinates and reuses the existing country geometry for coasts. The native packager bakes the cell index and segments into one 720 × 537 RGBA8 texture. Unit 5 uses nearest sampling so neighboring records never interpolate. Its 1,546,560 bytes replace the earlier 2,073,600-byte river/settlement mask. The map still uses one scene draw before post-processing.

The label set includes 155 additional settlements near the tour. The 678 names share one mipmapped atlas (1,760 × 1,904 R8), and fourteen per-label width uniforms help keep names inside the view. At the matched French camera stop the Metal frame selects thirteen names including Rouen, Orléans and Reims. In the Mississippi Valley the fine linework shows the river and its branches beside Memphis, Jackson and Baton Rouge. The coast follows the simplified source polygons and can appear angular at this scale. [Matched before-and-after frames](regional-detail.jpg)

The native build carries a single packed copy of each texture and strips the authoring data once the native sampler has been baked. Its full 18-scene JavaScript is 2,377,758 bytes (1,082,025 gzip). The new atlas file adds 434,222 compressed bytes to the source checkout. WebGL2, native GLES and Metal checks verified both camera poses and the map bindings. Metal readback matched every byte of the RGBA8 line index and the R8 label atlas, including the 1,760-byte atlas row stride.

The [regional packer](regional-pack.py) takes the camera revision's `33_contour.js` as `base.js` and the Natural Earth files as `inputs/cities.json` and `inputs/river50.json` alongside the script. The detail patch already contains the packed data. A muted Windows Chrome run on the RTX 4080 advanced 120–121 frames in 2.01 seconds at 1280 × 720 and passed four fresh starts, including an intentionally early first frame. Matched GPU timings averaged 2.08 ms near Paris and 1.69 ms in the Mississippi Valley.
