#!/bin/bash
# Signed, standalone APK with embedded JavaScript. Generate the key separately, under ~/.scratch,
# then export VELA_ANDROID_{KEYSTORE,STORE_PASSWORD,KEY_PASSWORD,KEY_ALIAS}. Never put lab credentials
# in EXPO_PUBLIC_*: Metro embeds them in the APK. Universal APK and AAB include 32-bit TV devices, arm64 devices and emulators.
# Usage: tools/android-release.sh [--phone] [output-directory]
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
phone=()
suffix=androidtv
if [ "${1:-}" = --phone ]; then
  phone=(--phone)
  suffix=android
  shift
fi
export VELA_ANDROID_ABI="${VELA_ANDROID_ABI:-armeabi-v7a,arm64-v8a,x86_64}"
source tools/android-env.sh
trap '(cd apps/vela/android && ./gradlew --stop >/dev/null 2>&1) || true' EXIT
: "${VELA_ANDROID_KEYSTORE:?Set the path to the upload keystore}"
: "${VELA_ANDROID_STORE_PASSWORD:?Set the keystore password}"
: "${VELA_ANDROID_KEY_PASSWORD:?Set the key password}"
if [ ! -f "$VELA_ANDROID_KEYSTORE" ]; then
  echo "Upload keystore does not exist" >&2
  exit 1
fi
unset EXPO_PUBLIC_VELA_SERVER EXPO_PUBLIC_VELA_USER EXPO_PUBLIC_VELA_PASSWORD EXPO_PUBLIC_VELA_MOCK
export EXPO_NO_DOTENV=1
out=${1:-$(dirname "$GRADLE_USER_HOME")/release}
mkdir -p "$out"
version=$(node -p "require('./apps/vela/app.json').expo.version")
tools/android-tv.sh --prebuild --no-install "${phone[@]}"
apk="$(dirname "$GRADLE_USER_HOME")/gradle-build/android/Vela/app/outputs/apk/release/app-release.apk"
cp "$apk" "$out/Vela-$version-$suffix.apk"
sha256sum "$out/Vela-$version-$suffix.apk"
# Play distributes device-specific APKs from this bundle.
(cd apps/vela/android && ./gradlew :app:bundleRelease --console=plain >"$(dirname "$GRADLE_USER_HOME")/android-bundle.log" 2>&1)
cp "$(dirname "$GRADLE_USER_HOME")/gradle-build/android/Vela/app/outputs/bundle/release/app-release.aab" "$out/Vela-$version-$suffix.aab"
(cd apps/vela/android && ./gradlew --stop >/dev/null 2>&1 || true)
# Large universal downloads also get smaller ARM alternatives; universal remains the default.
if [ "$(wc -c < "$apk")" -gt 104857600 ]; then
  for abi in armeabi-v7a arm64-v8a; do
    VELA_ANDROID_ABI="$abi" tools/android-tv.sh --prebuild --no-install "${phone[@]}"
    cp "$apk" "$out/Vela-$version-$suffix-$abi.apk"
  done
fi
(cd "$out" && sha256sum "Vela-$version-$suffix"*.apk "Vela-$version-$suffix.aab")
