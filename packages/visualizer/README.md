# Music visualizer

The current music app draws its Now Playing background and full-screen scene
picker with the same mounted `Visualizer`. The component takes
`{ mode: "background" | "fullscreen", sceneId?: string }`. The background
ignores focus and pointer events. In full screen, select the current scene name
to open the rail. Left and Right on the focused stage change scene. Menu, Back
and the close control return to the existing transport.

## Hosting

[Visualizer](../../apps/vela/src/visualizer/visualizer.tsx) uses the current
skin host and audio store. Its host mounts it only while the surface is visible
and uses [canVisualize](../../apps/vela/src/visualizer/availability.ts) to
select the ordinary artwork tint when the current route or device cannot draw
a scene. The component follows the app's foreground state. Paused and
reduced-motion surfaces hold a still, as does the open thumbnail rail on TV.
On Apple and Android, Now Playing shows the artwork until the background
presents its first frame and the full-screen button becomes available.
The picker exposes four [skin parts](../../apps/vela/src/visualizer/parts.ts).
[Scene selection](../../apps/vela/src/visualizer/setting.ts) stays local to the
server and viewer on this device. The optional initial scene applies when the
saved choice is missing or has been retired.

The browser export, including the desktop shells, observes the active gapless
engine's mixed PCM using a branch from its Web Audio graph. Element playback
retains the ambient background. Apple uses the AVPlayer music tap and Metal.
Android uses the Media3 music processor and GLES. Each platform reads the
heard window, including both decks in a crossfade. Scene IDs come from the
bundled [manifest](scenes.json). The renderer and its audio inputs are private
to the client.

## Scene assets

`scenes/` contains the picker author's ordered source parts. `framework/` is
the earlier snapshot used by the standalone host spikes. For a scene update,
install the reviewed source and its corresponding stills in `thumbnails/`.
From the repository root, regenerate with the pinned Bun and the authoring
tools glslang and SPIRV-Cross.

```sh
packages/visualizer/tools/build-release.sh
```

This links every scene against the recorder, captures shader sources and bakes
the map data. It regenerates the WebGL module, native JavaScript, Metal shader
table and library source, scene manifest and static thumbnail imports. The
Apple pod uses Xcode's Metal toolchain to compile a device- or simulator-specific
`viz-shaders.metallib` into its resource bundle. Android packages the same
JavaScript as Apple. The authoring tools run only when changing scene assets.
For atlas orientation, sampling, provenance and regeneration, see the
[map assets](assets/README.md).

The [Listen contract](spike/listen/README.md) records the approved future
document wrapper and generic block fallback. The [TV performance harness](../../tools/perf/README.md)
describes the capability measurements.
