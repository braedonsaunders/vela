# macOS release signing

Vela for Mac targets Apple silicon (arm64) only.

The default build is ad-hoc signed. For a Developer ID release, install the
Developer ID Application certificate (including its private key) in the build
machine's keychain, then run:

```sh
export VELA_MAC_SIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)'
export VELA_NOTARY_PROFILE=vela-notary
node build.mjs --ui=/path/to/0.2.16 --mac
```

Store notarization credentials with `xcrun notarytool store-credentials
vela-notary` beforehand. electron-builder 26 signs nested binaries and the app
with hardened runtime and the JIT entitlement. The after-sign hook submits the
app with `notarytool --wait`, staples and validates the ticket before DMG/ZIP
packaging. Missing identity skips Developer ID signing. With an identity, the hook checks
the default `vela-notary` profile and skips notarization only when it is not stored.
`VELA_NOTARY_PROFILE` selects another profile and requires it to be usable. Signing/notarization failures fail the build. The DMG contains the
signed, stapled app; the disk image itself is not separately signed.

For the native Apple playback payload, first run `mac/build.mjs` and then package
from this directory with matching architecture and scratch output:

```sh
VELA_MAC_SIGN_IDENTITY='Developer ID Application: Braedon Saunders (9YL3YCJTNT)' \
VELA_NOTARY_PROFILE=vela-notary \
node build.mjs --mac --arch=arm64 --ui=/path/to/export \
  --native-mac="$HOME/.scratch/tmp/<thread>/native-mac" \
  --output="$HOME/.scratch/tmp/<thread>/dist"
```

The explicit notarization profile makes unavailable credentials fail the build.
Keep the signed `.app` for notarization by the release owner if that happens.
Use `VELA_DATA_DIR` for an isolated development profile and `VELA_NATIVE_MAC_DIR`
for its scratch native payload; neither changes the installed application.
