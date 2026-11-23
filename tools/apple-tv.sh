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
# Defaults may live in .apple-tv.env at the repository root (gitignored; the environment wins), for example:
#   VELA_APPLE_TV=<device udid or name>
#   VELA_APPLE_TEAM=<team id>
#   VELA_BUILD_DIR=<directory for DerivedData and logs>   (default: .build/apple-tv)
#   VELA_NATIVE_LOCK=<lock file shared with other native builds> (optional)
# A lab build can pin its Ether server with EXPO_PUBLIC_VELA_SERVER; release builds run standalone.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
if [ -f "$root/.apple-tv.env" ]; then
  # A value already in the environment wins over the file's.
  for name in VELA_APPLE_TV VELA_APPLE_TEAM VELA_BUILD_DIR VELA_NATIVE_LOCK; do
    eval "[ -n \"\${$name:-}\" ] && saved_$name=\$$name" || true
  done
  . "$root/.apple-tv.env"
  for name in VELA_APPLE_TV VELA_APPLE_TEAM VELA_BUILD_DIR VELA_NATIVE_LOCK; do
    eval "[ -n \"\${saved_$name+set}\" ] && $name=\$saved_$name" || true
  done
fi
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

project="$root/apps/vela/ios/Vela.xcodeproj/project.pbxproj"
# A project generated for iPhone (tools/ios.sh) builds nothing for Apple TV: regenerate it.
if [ -f "$project" ] && ! grep -q 'SDKROOT = appletvos' "$project"; then prebuild=1; fi
# libass (ASS/SSA as authored) is built once per checkout and again when ass/build.sh changes; the
# podspec picks it up at pod install.
if ! "$root/modules/vela-player/ios/ass/build.sh" --check; then
  locked "$root/modules/vela-player/ios/ass/build.sh" --work "$build/libass"
  prebuild=1
fi
if [ "$prebuild" = 1 ] || [ ! -d "$root/apps/vela/ios" ]; then
  (cd "$root/apps/vela" && EXPO_TV=1 locked bun x expo prebuild -p ios --clean)
fi

cd "$root/apps/vela/ios"
# The generated project keeps the version it was generated with: the app's version is app.json's.
version=$(sed -n 's/^ *"version": "\([0-9.]*\)".*/\1/p' "$root/apps/vela/app.json" | head -1)
[ -n "$version" ] && /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" Vela/Info.plist
# A native module's new or removed files join the Pods project only through pod install.
if [ -n "$(find "$root/modules" -path '*/ios/*' -newer Pods/Manifest.lock -print -quit 2>/dev/null)" ]; then
  pod install >/dev/null
fi
if [ "$simulator" = 1 ]; then
  # Signed to run locally: an unsigned app has no Keychain, where the app keeps its sessions.
  set -- -sdk appletvsimulator -destination 'generic/platform=tvOS Simulator' CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=""
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
  uuid='[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}'
  sim=$(xcrun simctl list devices booted | grep 'Apple TV' | grep -oE "$uuid" | head -1)
  if [ -z "$sim" ]; then
    sim=$(xcrun simctl list devices available | grep 'Apple TV' | grep -oE "$uuid" | head -1)
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
