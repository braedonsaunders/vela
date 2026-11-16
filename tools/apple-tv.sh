#!/bin/sh
# Build apps/vela for an Apple TV (Release: the JS bundle is embedded, no Metro), sign it with the
# team's automatic provisioning, install it, and optionally open a route.
#
#   tools/apple-tv.sh [--prebuild] [--device <udid|name>] [--open <vela://route>]
#
# --prebuild regenerates apps/vela/ios for tvOS (EXPO_TV=1 expo prebuild --clean, then pod install).
# DerivedData lives on the scratch drive. The full xcodebuild log is written beside it.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
device=${VELA_APPLE_TV:-00008110-000238E12ED3801E}
prebuild=0
open=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prebuild) prebuild=1 ;;
    --device) device=$2; shift ;;
    --open) open=$2; shift ;;
    *) echo "usage: tools/apple-tv.sh [--prebuild] [--device <udid|name>] [--open <vela://route>]" >&2; exit 2 ;;
  esac
  shift
done
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
export LANG=en_US.UTF-8
export PATH="$root/.tools/bun-darwin-aarch64:$PATH"
# One scratch directory per worktree (worktrees are all named vela: take their parent's name then).
name=$(basename "$root")
[ "$name" = vela ] && name=$(basename "$(dirname "$root")")
scratch=$(cd "$HOME/.scratch" && pwd -P)/vela-build/$name
derived=$scratch/apple-tv-derived
log=$scratch/apple-tv-xcodebuild.log
mkdir -p "$scratch/tmp"
# Metro keeps its cache under TMPDIR: one per worktree, so a bundle never resolves another worktree's files.
export TMPDIR="$scratch/tmp/"

if [ "$prebuild" = 1 ] || [ ! -d "$root/apps/vela/ios" ]; then
  (cd "$root/apps/vela" && EXPO_TV=1 bun x expo prebuild -p ios --clean)
fi

cd "$root/apps/vela/ios"
# A native module's new or removed files join the Pods project only through pod install.
if [ -n "$(find "$root/modules" -path '*/ios/*' -newer Pods/Manifest.lock -print -quit 2>/dev/null)" ]; then
  pod install >/dev/null
fi
if ! xcodebuild -workspace Vela.xcworkspace -scheme Vela -configuration Release \
  -sdk appletvos -destination 'generic/platform=tvOS' -derivedDataPath "$derived" \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=9YL3YCJTNT CODE_SIGN_STYLE=Automatic \
  build >"$log" 2>&1; then
  grep -E "error:|Undefined symbols|The following build commands failed" -A3 "$log" | head -40
  echo "apple-tv: build failed; the log is $log" >&2
  exit 1
fi
app=$derived/Build/Products/Release-appletvos/Vela.app
xcrun devicectl device install app --device "$device" "$app" >/dev/null
echo "apple-tv: installed $app"
if [ -n "$open" ]; then
  xcrun devicectl device process launch --device "$device" --terminate-existing --payload-url "$open" app.ether.vela >/dev/null
  echo "apple-tv: opened $open"
fi
