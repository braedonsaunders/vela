# macOS release signing

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
packaging. Missing identity skips Developer ID signing; missing profile skips
notarization. Signing/notarization failures fail the build. The DMG contains the
signed, stapled app; the disk image itself is not separately signed.
