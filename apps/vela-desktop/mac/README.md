# macOS Aether host

The Electron bridge loads `mac/host.js`. The N-API shim retains an in-process
Swift session and inserts a noninteractive NSView below the Chromium children
of the BrowserWindow content view. Electron owns transparency and fullscreen;
DOM bounds arrive in content DIP coordinates. macOS 15 or newer on Apple silicon is required.

Build the arm64 host (Xcode required):

```
node apps/vela-desktop/mac/build.mjs --arch=arm64 --out=$HOME/.scratch/tmp/<thread>/native-mac
```

`--node-headers` optionally selects an
Electron `include/node` directory; the default is the existing 40.8.0 N-API
headers. The addon uses the stable N-API, not Electron's V8 ABI. SwiftPM builds
AetherEngine 7.70.0; Package.resolved pins its transitive dependencies. ASS/SSA
subtitles render through libass, as on tvOS and iOS: the build runs
`modules/vela-player/ios/ass/build.sh` (needs meson, ninja and pkg-config) when its
output is missing or stale, links `Libass.xcframework` and `Fribidi.xcframework` as
binary targets and copies both frameworks, ad-hoc signed with the hardened runtime,
beside `libVelaNative.dylib`, with their licences in `Licenses`. Build
staging is adjacent to the output. No generated binaries belong in Git.

The shared desktop build accepts `--native-mac=<payload>` and copies it to
`Contents/Resources/native-mac`. The payload and Electron app are arm64-only. `VELA_NATIVE_MAC_DIR` selects a scratch payload for development. The runner
app must also contain `AetherEngine_AetherEngine.bundle` at its Resources root;
the host remains unavailable without that bundle.
Sign every nested framework, dylib and addon with the app's Developer ID and
hardened runtime before signing the app. Same-team signing avoids disabling
library validation. Ship the copied `Licenses` directory with the binaries;
FFmpeg frameworks and `Fribidi.framework` remain dynamic and replaceable under LGPL 2.1. Their build
source and instructions are linked in the bundled FFmpegBuild README.

`host.diagnostics()` reports current and potential screen EDR headroom. An HDR
codec declaration is not proof of HDR output: verify headroom and visible
playback on the target display. Windowed playback suppresses display matching;
fullscreen alone may request it. Aether's display-criteria implementation is a
no-op on macOS; EDR composition still applies to HDR layers.

Dolby Vision capability is deliberately unclaimed on macOS. Aether's pinned
`docs/formats.md` explains that macOS has no per-mode HDR capability API: EDR
eligibility proves HDR10/HLG, not Dolby Vision presentation. Aether can preserve
DV sample entries and RPU metadata through AVFoundation (including Profile 5,
8.1 and 8.4 paths); the effective format can be promoted after AVFoundation
accepts DV media. This host does not assert `panelPresentsDolbyVision`, and
neither an EDR screen nor a DV file alone proves DV presentation. Verify the
actual route and output on the target display before adding a DV capability.
