#!/bin/bash
# Build apps/vela for Android TV (or a phone with --phone), install it on an emulator or device, and
# optionally open a route. Release by default: the JS bundle is embedded, no Metro. --debug builds the
# variant that loads JavaScript from Metro (start it yourself with `bun x expo start --clear`).
#
#   tools/android-tv.sh [--prebuild] [--phone] [--debug] [--device <serial>] [--open <vela://route>]
#
# --prebuild regenerates apps/vela/android (expo prebuild --clean; EXPO_TV=1 unless --phone).
# libmpv must be built first (modules/vela-player/android/libmpv/build.sh). Gradle's home and the app's
# build output live on the scratch drive (tools/android-env.sh); the Gradle daemon is stopped at the end.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
prebuild=0
phone=0
variant=Release
device=""
open=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prebuild) prebuild=1 ;;
    --phone) phone=1 ;;
    --debug) variant=Debug ;;
    --device) device=$2; shift ;;
    --open) open=$2; shift ;;
    *) echo "usage: tools/android-tv.sh [--prebuild] [--phone] [--debug] [--device <serial>]" \
         "[--open <vela://route>]" >&2
       exit 2 ;;
  esac
  shift
done

cd "$root"
# shellcheck source=android-env.sh
source tools/android-env.sh
export PATH="$root/.tools/bun-darwin-aarch64:$PATH"
scratch="$(dirname "$GRADLE_USER_HOME")"
log="$scratch/android-gradle.log"

if [ "$prebuild" = 1 ] || [ ! -d apps/vela/android ]; then
  tv=1
  [ "$phone" = 1 ] && tv=""
  (cd apps/vela && EXPO_TV=$tv bun x expo prebuild -p android --clean --no-install)
fi

cd apps/vela/android
# R8 is for distributed builds; a development install skips it. The embedded JS bundle is always
# rebuilt: Gradle does not see changes to EXPO_PUBLIC_* in .env files.
bundle=()
[ "$variant" = Release ] && bundle=(":app:createBundleReleaseJsAndAssets" --rerun)
if ! ./gradlew ${bundle[@]+"${bundle[@]}"} ":app:assemble$variant" -Pandroid.enableMinifyInReleaseBuilds=false \
  --console=plain >"$log" 2>&1; then
  grep -E "error:|e: |What went wrong" -A3 "$log" | head -40
  ./gradlew --stop >/dev/null 2>&1 || true
  echo "android-tv: build failed; the log is $log" >&2
  exit 1
fi
./gradlew --stop >/dev/null 2>&1 || true

lower=$(echo "$variant" | tr '[:upper:]' '[:lower:]')
apk="$scratch/gradle-build/android/Vela/app/outputs/apk/$lower/app-$lower.apk"
target=()
[ -n "$device" ] && target=(-s "$device")
adb ${target[@]+"${target[@]}"} install -r "$apk" >/dev/null
echo "android-tv: installed $apk"
if [ -n "$open" ]; then
  adb ${target[@]+"${target[@]}"} shell am start -a android.intent.action.VIEW -d "$open" app.ether.vela >/dev/null
  echo "android-tv: opened $open"
fi
