# Round-five scene candidate

This optional patch reproduces the 18-scene review page from the measured framework on this branch. The lead verified the page in muted Chrome. Owner approval of this selection is pending.

| Input | Identity |
| --- | --- |
| Measured Git framework tree | `aefedbb75e82ed10cca337678dca559cfcd44c05` at `packages/visualizer/framework` |
| Authoring input | Ordered parts in `viz-unified/src`, concatenated by its build script |
| Reassembled authoring page | 192,969 bytes, SHA-256 `1536545c0a7a3b9377f93477db4040441eba30fd799c0b3a035c10b2fbb38b9b` |
| Patch SHA-256 | `9df42435ccbe164e62212cb59a2b3d94015f598e79c469ce107092eaea9b7ae0` |

The candidate removes Meridian and Isoline Atoll. It revises Neon Cartography, Watercolour, Ink in Water, Incense, Falling Leaves, Wind in the Wheat and Shallows. It also carries the two-line Nebula change already present in the authoring workspace's round-four archive (36 ray-march steps and updated cost description). This brings the earlier measured snapshot into agreement with the reviewed Nebula.

## Review in a disposable checkout

Run these commands at the Vela repository root in a disposable checkout of this branch. Applying the patch changes the framework files in that checkout.

```sh
patch=packages/visualizer/spike/candidates/round-five.patch
git apply --check "$patch"
git apply "$patch"
(
  cd packages/visualizer/framework
  { cat 00_head.html; cat [1-9]*.js; printf '</script>\n</body>\n</html>\n'; } | shasum -a 256
)
```

In isolated verification, the patched framework reconstructed the page hash above. The headless bundle listed 18 unique scenes and captured 57 programs. All 114 GLSL stages passed glslang validation. The Apple build tool generated MSL and reflection for every captured program, including both offscreen and onscreen vertex variants. After the shared label atlas was added, the candidate also initialized all 18 scenes in the headless host. Native target compilation and playback of this candidate were outside the candidate check. The host timing measurements describe the measured snapshot.
