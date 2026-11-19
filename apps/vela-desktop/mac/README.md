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
AetherEngine 7.70.0; Package.resolved pins its transitive dependencies. Build
staging is adjacent to the output. No generated binaries belong in Git.

The shared desktop build accepts `--native-mac=<payload>` and copies it to
`Contents/Resources/native-mac`. The payload and Electron app are arm64-only. `VELA_NATIVE_MAC_DIR` selects a scratch payload for development.
Sign every nested framework, dylib and addon with the app's Developer ID and
hardened runtime before signing the app. Same-team signing avoids disabling
library validation. Ship the copied `Licenses` directory with the binaries;
FFmpeg frameworks remain dynamic and replaceable under LGPL 2.1. Their build
source and instructions are linked in the bundled FFmpegBuild README.

`host.diagnostics()` reports current and potential screen EDR headroom. An HDR
codec declaration is not proof of HDR output: verify headroom and visible
playback on the target display. Windowed playback suppresses display matching;
fullscreen alone may request it. Aether's display-criteria implementation is a
no-op on macOS; EDR composition still applies to HDR layers.
