# Round-six scene candidate

[Round-six patch](round-six.patch) reconstructs the 18-scene review page from the measured framework tree `aefedbb75e82ed10cca337678dca559cfcd44c05`. Apply it directly to that tree in a disposable checkout. The patch includes the earlier curation changes. The host measurements in the spike report used the measured framework.

```sh
patch=packages/visualizer/spike/candidates/round-six.patch
shasum -a 256 "$patch"
git apply --check "$patch"
git apply "$patch"
(
  cd packages/visualizer/framework
  { cat 00_head.html; cat [1-9]*.js; printf '</script>\n</body>\n</html>\n'; } | shasum -a 256
)
```

| Artifact | SHA-256 |
| --- | --- |
| Patch | `26f9ac435b26395d821f656b23a3c77784a8fe3e2449d1484867cc906327ad69` |
| Reconstructed index.html, 232,497 bytes | `b9f7303b8b7546343e02810b3b1526e9e67938dc6bbc9de778d1844899cae308` |
| Falling Leaves source, identical in rounds five and six | `73334e2acb7560601a5c291b1528f49934ef916ea287f873effc8ecbf4eacaf5` |

The six revised scene sources are Neon Cartography, Watercolour, Ink in Water, Incense, Wind in the Wheat and Shallows. The shader capture exercised all 18 scene initializers with a recording WebGL stub. All 57 program pairs passed GLSL ES 3.00 stage validation, including the 9 pairs with changes since round five (10 new distinct shader stages). The host's glslang and SPIRV-Cross pipeline generated Metal Shading Language and reflection for all 57, including both vertex orientations. Native rendering checks appear below.

## Cartography inputs

The patch includes the packed geography used by the page. The author's `round6-work/pack.py` took Natural Earth's public-domain 1:110m country rings and 1:50m populated places, quantized the rings to eighths of a degree and selected 523 city labels. Running the packer against the inputs below reproduced the 42,988-byte JavaScript fragment in the candidate.

| Authoring artifact | SHA-256 |
| --- | --- |
| pack.py | `c8365d927c125729242449a91453958b521d03da1300484c1e67925260178737` |
| countries.json, 177 features | `6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f` |
| cities.json | `8e70756b39fae9bcdc1e332bfc510c024c5edd3a13203ffd20092ee37b61d978` |
| packed.txt | `ecaa2b96bb1c9f81d3410d7100cf82628f559892e4ec15a7a27c6c1cc1011588` |

To regenerate the geography fragment, place the two verified GeoJSON inputs in a scratch directory as `countries.json` and `cities.json` and run the [original packer](round-six-pack.py) there. The candidate patch already contains its output. [Natural Earth country input](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson) · [Populated places input](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_populated_places_simple.geojson)

## Native map

Pass the patched framework directory to the native packager. Omit `--scenes contour` to include all 18 scenes.

```sh
bun packages/visualizer/tools/build.ts --framework "$candidateFramework" --scenes contour --out "$dist"
bun packages/visualizer/tools/apple-shaders.ts "$dist"
```

During packaging the candidate's scan converter rasterizes 177 countries to a 2880 × 1440 R8 texture. The native bundle stores runs of country IDs and reconstructs the bytes at scene initialization. Every texel matched the authoring map (SHA-256 `d0ba008061f3f970701cc4fb31768b68c22dc3d3cd89e3009f9cc41e115acbe7`). Longitude wraps, latitude clamps and nearest sampling preserves integer IDs at borders. The separate 523-city atlas uses 8 columns, 66 rows and 176 × 28 cells. It uploads bottom-row-first and uses trilinear sampling. Its 2,601,984 bytes and the country IDs upload once per initialization.

GLES and Metal each rendered the map with recognizable coasts, national borders and upright city names. The GLES driver linked all 57 program pairs. Apple's M4 Pro compiled all 171 MSL variants and resolved their named functions. The Metal capture used the JavaScriptCore runtime, the actual Metal executor and 120 offscreen frames at 1920 × 1080 with offline decoded music. [Metal map capture](round-six-metal.jpg)
