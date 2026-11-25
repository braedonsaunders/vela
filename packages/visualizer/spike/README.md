# Music visualizer host spike

Keep GLSL ES 3.00 as the scene source. The same JavaScript selects passes, binds history textures, changes palettes and drives transitions on each host. WebGL2 executes it directly in a browser. On native, the recording facade emits typed commands for an executor on the rendering thread. That keeps fluid simulation and scene transitions in one implementation. The spike runs independently of the Vela player UI.

| Client | Renderer | Where the samples come from |
| --- | --- | --- |
| Web, Mac/Linux Electron, Windows WebView2 | WebGL2 in the music view | Observe the existing Listen output mix in Web Audio, including the overlap between tracks. The desktop video engines have a separate path. |
| iPhone, iPad, Apple TV | JavaScriptCore and Metal | Copy mono PCM from the music item's processing tap. Read the window ending at the player's heard position on the render thread. |
| Android phone, tablet, TV | Hermes and a C++ GLES executor on the GL thread | Media3 audio processor plus the sink's latency-adjusted playback position. |

The native host issues one synchronous buffer flush per frame, plus flushes for setup and linking. The FFT, 256 log-band maxima and 512 aligned waveform samples are computed off the playback thread. The JavaScript interpretation of those values drives the same envelopes and beat counters the browser uses. UI controls need scene IDs, visibility and preferences. Per-frame samples and draw commands stay off the React Native bridge. See the [command layout and DSP specification](../runtime/PROTOCOL.md) and the [Listen proposal and mockups](listen/README.md).

## Why this pipeline

Before embedding the map atlas, the saved full-framework bundle contains 63 distinct GLSL program pairs. Its generated JS was 216 KiB (71 KiB gzipped), and the Metal shader and reflection table is 1.40 MiB (163 KiB gzipped). glslang and SPIRV-Cross produce the table ahead of time. The full native JS with the baked atlas is 298 KiB. A two-scene bundle of Ink and Hyperspace omits the atlas. The spike compiles those MSL strings into Metal libraries at runtime. Shipping a metallib and warming pipelines during idle time would address cold switches. The initial cross-compiler experiment built all 122 stages of the earlier snapshot for the tvOS simulator. The real WebGL2 record/replay check compared final RGB pixels with a deterministic seed and matched for 19 scenes. Contour subsequently gained a shared build-time R8 atlas for its map labels. The [candidate patch](candidates/README.md) reproduces the separately reviewed 18-scene browser input.

WGSL and naga would require converting the existing shader library and supplying a GLES path for low-end TVs. React Native Skia has a working tvOS example. SkSL effects could be drawn into successive surfaces for feedback, but the port would also have to reproduce the point and instanced geometry, depth, multisampling, float targets and pass scheduling. These are engineering comparisons. Only the GLSL pipeline was timed. [Skia runtime effects](https://skia.org/docs/user/sksl/) · [React Native Skia TV example](https://github.com/react-native-tvos/SkiaMultiplatform)

## Measured web rendering

Windows Chrome 158 rendered 1280 × 720 on an RTX 4080 using ANGLE/D3D11. The harness drove Vela's gapless web player with a local MP3 and a zero-gain output. In the 20-second window following two seconds of playback, Ink produced 1,199 frames and Hyperspace 1,201. Median and p99 frame intervals for each were 16.7 and 16.8 ms. CPU submission averaged 0.318 and 0.335 ms. The beat counters advanced 59 and 58 times. Both runs advanced the audio clock 20 seconds with zero player stalls or device underruns during measurement. At startup each recorded one output underrun, lasting 12.0 and 8.9 ms respectively. The first software-rendered WSL run with MP3 transfer through an SSH tunnel also recorded waits. These conditions matter when comparing browser and native playback.

## Measured native rendering

The standalone hosts played a local music file, copied real samples for analysis and zeroed the audio buffers before output. Screenshots show the branching dye plumes in Ink and the radial streaks in Hyperspace (scene ID `tunnel`). The simulators exercise different GPUs.

| Host and sample | Ink in Water | Hyperspace |
| --- | --- | --- |
| tvOS simulator, Mac GPU, median of one-second reports after switching | 59 frames/report, 1.78 ms CPU and 0.91 ms GPU | 61 frames/report, 0.77 ms CPU and 0.45 ms GPU |
| Android TV API 36, SwiftShader, 1080p, mean frame interval after ten warm-up windows | 509 ms, with 3.14 ms in JS and GL submission | 607 ms, with 2.17 ms in JS and GL submission |

Apple figures use seconds 91–95 and 193–197 of the capture, respectively. Both ran near 1080p. Ink reduced its internal resolution to 1764 × 992 in the last window. Its worst interval in the five windows was 140 ms, and the interval at the switch reached 285 ms. The 211-second trace records zero AVPlayer stall notifications. At the end the tap had written through 210.26 seconds against a heard position of 209.89 seconds. The beat count reached 540 and the spectrum and level varied with the track. Stall notifications cover player stalls, not every possible output glitch.

The framework governor ignores gaps over 250 ms, so sustained software-rendered frames can leave the starting budget unchanged. Set a conservative initial tier using actual capabilities and count consecutive over-budget frames even when the interval exceeds that cutoff.

On Android the measured windows averaged 0.157 and 0.150 ms for DSP. The tracks ran for roughly 82 and 86 seconds with zero AudioTrack underruns and zero logged JS or GL errors. The emulator exposes no GPU timer. Its software render rate demonstrates why a 1080p average submission time alone cannot select a hardware tier. Android beat alignment and sustained hardware frame time need device measurements.

## Map label verification

The fixed label asset is 1024 × 200 R8 with four columns and five rows. The generator drew the framework's own labels, reversed the canvas rows once, and verified the padding cells. The bundle uploads the bytes without a second flip. The GLES executor generated eleven mip levels through 1 × 1 and used trilinear minification. In the muted GLES capture, CADENCE reads upright beside two towns and the last occupied row supplies NEON CARTOGRAPHY and SURVEY IN PROGRESS at the bottom left. [Full map capture](cartography-gles.jpg) · [Atlas and regeneration](../assets/README.md)

## Proposed quality tiers

Use the existing pixel budget governor with host-specific bounds and scene-level controls. The following are starting settings for device trials.

| Host condition | Target | Initial scene budget |
| --- | --- | --- |
| Budget Google TV | 30 fps, 33.3 ms per frame | Start at 640 × 360 internally. Use a 128 × 80 fluid grid, ten pressure iterations and 512 × 320 dye. Disable MSAA and depth of field. |
| Phone on battery or in low-power mode | 30 fps | Start at 720p or viewport size, whichever is smaller. Halve particle grid dimensions on each axis and reduce wheat instances. |
| Tablet or phone on external power | Try 60 fps, fall back to 30 | Start at 720p, try 1080p after sustained headroom. Restore simulation detail before raising output resolution. |
| Apple TV 4K | Try 60 fps with 1080p internal rendering | Composite into the TV drawable at display resolution. Keep a 30 fps tier for sustained misses. |
| Desktop | 60 fps, 30 on battery saver | Start with the framework's 2.4 megapixel cap. Increase only after measuring the scene on that GPU. |

Track missed presentation deadlines over consecutive windows. Reduce the output pixel budget first for expensive fullscreen passes. For simulation-bound scenes, reduce the fluid grid, Jacobi iterations, particle texture dimensions or instance counts independently. Silk's two full-size state textures alone use 64 MiB. Keep only the active and transitioning scenes' large allocations. On a constrained device, fade from a saved still so only the incoming scene simulates. Persist the stable tier for that scene and device. Probe renderable formats, sample counts and framebuffer completeness before offering a scene. Silk writes RGBA32F and requires full-float renderability.

Reduce Motion should start with cover art, offer a still frame and require an explicit action for animation. Suspend frame callbacks and stop requesting analysis when hidden, backgrounded, or covered by another view. Resume from the current player clock. Under pressure discard the oldest visual samples, drop frames and leave the playback clock alone. Test seeks, route/sample-rate changes, foregrounding, gapless transitions and AutoMix with a bounded, synchronized tap buffer before integrating with the live player. The spike measures one track. Its single-track rings, host sizing, startup warm-up and lifecycle are prototype code.

## Reproduction

Generate a two-scene native bundle in a scratch directory:

```sh
bun packages/visualizer/tools/build.ts --scenes ink,tunnel --out "$dist"
bun packages/visualizer/tools/apple-shaders.ts "$dist" --sdk appletvsimulator --check
packages/visualizer/spike/apple/build.sh "$dist" "$track" "$out" tvos
```

Use a dedicated muted simulator and a local file for which playback is authorized. The Apple harness accepts `-scene ink` or `-scene tunnel` and writes `tmp/viz-stats.log` in its app data container. The Android [runner](android/run.sh) builds on the configured Linux worker, controls its own emulator, retrieves the log and screenshot, and stops the spike. The [web harness](web/serve.ts) serves the gapless player probe, local music and generated scene bundle on loopback. The [analysis comparison](../test/analyse-split.test.ts) exercises both implementations with the same deterministic signal and varying frame intervals.
