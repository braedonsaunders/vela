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

The authoring tool `round7-work/map.py` selects 187 river features of scale rank 4 or better from 462 Natural Earth 1:50m features. It simplifies each polyline with a 0.09-degree tolerance, quantizes to eighths of a degree and delta-encodes the coordinates. It appends 1,251 settlement positions from the Natural Earth populated places source used in round six. Running the packer against the frozen inputs reproduced the embedded 15,304-byte base64 payload. At runtime the scene reads river coverage and settlement markers from a 1440 × 720 two-channel texture.

| Authoring input | SHA-256 |
| --- | --- |
| map.py | `77c22085d96ad0893921a4458255ae703c899a0381a8a8f2b0d018e9f3d5d374` |
| river50.json | `f286e0ce978fde999ca2d7a78c764be08542e19b63cded52b05c12d5173ccc51` |
| cities.json | `8e70756b39fae9bcdc1e332bfc510c024c5edd3a13203ffd20092ee37b61d978` |
