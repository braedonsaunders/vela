#!/bin/sh
# Build apps/vela for Apple TV (Release: the JS bundle is embedded, no Metro), sign it with your
# team's automatic provisioning, install it, and optionally open a route.
#
#   tools/apple-tv.sh [--prebuild] [--simulator] [--device <udid|name>] [--team <id>] [--open <vela://route>]
#
#   --prebuild   regenerate apps/vela/ios for tvOS (EXPO_TV=1 expo prebuild --clean, then pod install)
#   --simulator  build for the tvOS simulator and install on the booted (or first) Apple TV simulator
#   --device     a paired Apple TV; when omitted and exactly one is connected, that one is used
#   --team       your Apple developer team ID (device builds; see Xcode > Settings > Accounts)
#
# Defaults may live in .apple-tv.env at the repository root (gitignored), for example:
#   VELA_APPLE_TV=<device udid or name>
#   VELA_APPLE_TEAM=<team id>
#   VELA_BUILD_DIR=<directory for DerivedData and logs>   (default: .build/apple-tv)
#   VELA_NATIVE_LOCK=<lock file shared with other native builds> (optional)
# A lab build can pin its Ether server with EXPO_PUBLIC_VELA_SERVER; release builds run standalone.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$root/.apple-tv.env" ] && . "$root/.apple-tv.env"
device=${VELA_APPLE_TV:-}
team=${VELA_APPLE_TEAM:-}
prebuild=0
simulator=0
open=""
usage="usage: tools/apple-tv.sh [--prebuild] [--simulator] [--device <udid|name>] [--team <id>] [--open <vela://route>]"
while [ $# -gt 0 ]; do
  case "$1" in
    --prebuild) prebuild=1 ;;
    --simulator) simulator=1 ;;
    --device) device=$2; shift ;;
    --team) team=$2; shift ;;
    --open) open=$2; shift ;;
    -h|--help) echo "$usage"; exit 0 ;;
    *) echo "$usage" >&2; exit 2 ;;
  esac
  shift
done
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
export LANG=en_US.UTF-8
[ -d "$root/.tools/bun-darwin-aarch64" ] && export PATH="$root/.tools/bun-darwin-aarch64:$PATH"
build=${VELA_BUILD_DIR:-$root/.build/apple-tv}
derived=$build/derived
log=$build/xcodebuild.log
mkdir -p "$build/tmp"
# Metro keeps its cache under TMPDIR: one per checkout, so a bundle never resolves another checkout's files.
export TMPDIR="$build/tmp/"

# Optionally serialize heavy native tools (simulators, xcodebuild, Gradle) across checkouts.
locked() {
  if [ -n "${VELA_NATIVE_LOCK:-}" ]; then
    mkdir -p "$(dirname "$VELA_NATIVE_LOCK")"
    perl -MFcntl=:flock -e 'open(my $f,">>",shift);flock($f,LOCK_EX);my $p=fork();if(!$p){exec @ARGV}waitpid($p,0);exit($?>>8)' "$VELA_NATIVE_LOCK" "$@"
  else
    "$@"
  fi
}

if [ "$simulator" = 0 ] && [ -z "$device" ]; then
  # The only connected (or paired and available) physical Apple TV, if there is exactly one.
  found=$(xcrun devicectl list devices 2>/dev/null | awk '/AppleTV/ && /physical/ && /available|connected/ {for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) print $i}')
  if [ "$(printf '%s\n' "$found" | grep -c .)" = 1 ]; then device=$found; fi
  if [ -z "$device" ]; then echo "apple-tv: no single available Apple TV; pass --device or set VELA_APPLE_TV (xcrun devicectl list devices)" >&2; exit 2; fi
fi
if [ "$simulator" = 0 ] && [ -z "$team" ]; then
  echo "apple-tv: device builds need your team ID; pass --team or set VELA_APPLE_TEAM" >&2; exit 2
fi

if [ "$prebuild" = 1 ] || [ ! -d "$root/apps/vela/ios" ]; then
  (cd "$root/apps/vela" && EXPO_TV=1 locked bun x expo prebuild -p ios --clean)
fi

cd "$root/apps/vela/ios"
# A native module's new or removed files join the Pods project only through pod install.
if [ -n "$(find "$root/modules" -path '*/ios/*' -newer Pods/Manifest.lock -print -quit 2>/dev/null)" ]; then
  pod install >/dev/null
fi
if [ "$simulator" = 1 ]; then
  set -- -sdk appletvsimulator -destination 'generic/platform=tvOS Simulator' CODE_SIGNING_ALLOWED=NO
  products=Release-appletvsimulator
else
  set -- -sdk appletvos -destination 'generic/platform=tvOS' -allowProvisioningUpdates DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Automatic
  products=Release-appletvos
fi
if ! locked xcodebuild -workspace Vela.xcworkspace -scheme Vela -configuration Release -derivedDataPath "$derived" "$@" build >"$log" 2>&1; then
  grep -E "error:|Undefined symbols|The following build commands failed" -A3 "$log" | head -40
  echo "apple-tv: build failed; the log is $log" >&2
  exit 1
fi
app=$derived/Build/Products/$products/Vela.app

if [ "$simulator" = 1 ]; then
  sim=$(xcrun simctl list devices booted | awk -F '[()]' '/Apple TV/ {print $2; exit}')
  if [ -z "$sim" ]; then
    sim=$(xcrun simctl list devices available | awk -F '[()]' '/Apple TV/ {print $2; exit}')
    [ -n "$sim" ] || { echo "apple-tv: no Apple TV simulator (Xcode > Settings > Platforms)" >&2; exit 2; }
    xcrun simctl boot "$sim"
  fi
  xcrun simctl install "$sim" "$app"
  echo "apple-tv: installed $app on simulator $sim"
  if [ -n "$open" ]; then xcrun simctl openurl "$sim" "$open"; else xcrun simctl launch "$sim" app.ether.vela >/dev/null; fi
  exit 0
fi
xcrun devicectl device install app --device "$device" "$app" >/dev/null
echo "apple-tv: installed $app"
if [ -n "$open" ]; then
  xcrun devicectl device process launch --device "$device" --terminate-existing --payload-url "$open" app.ether.vela >/dev/null
  echo "apple-tv: opened $open"
fi
