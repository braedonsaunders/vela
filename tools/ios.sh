#!/bin/sh
# Build apps/vela for iPhone (Release: the JS bundle is embedded, no Metro), sign it with your
# team's automatic provisioning, install it, and launch it or open a route.
#
#   tools/ios.sh [--prebuild] [--simulator] [--device <udid|name>] [--team <id>] [--open <vela://route>]
#
#   --prebuild   regenerate apps/vela/ios for iOS (expo prebuild --clean without EXPO_TV, then pod install)
#   --simulator  build for the iOS simulator and install on the booted (or first) iPhone simulator
#   --device     a paired iPhone; when omitted and exactly one is connected, that one is used
#   --team       your Apple developer team ID (device builds; see Xcode > Settings > Accounts)
#
# apps/vela/ios is generated for one platform at a time: tools/apple-tv.sh generates it for tvOS,
# this script for iOS, and each regenerates it when it finds the other platform's project.
#
# Defaults may live in .apple-tv.env at the repository root (gitignored; the environment wins), for example:
#   VELA_IPHONE=<device udid or name>
#   VELA_APPLE_TEAM=<team id>
#   VELA_IOS_BUILD_DIR=<directory for DerivedData and logs>   (default: .build/ios)
#   VELA_NATIVE_LOCK=<lock file shared with other native builds> (optional)
# A lab build can pin its Ether server with EXPO_PUBLIC_VELA_SERVER; release builds run standalone.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
if [ -f "$root/.apple-tv.env" ]; then
  # A value already in the environment wins over the file's.
  for name in VELA_IPHONE VELA_APPLE_TEAM VELA_IOS_BUILD_DIR VELA_NATIVE_LOCK; do
    eval "[ -n \"\${$name:-}\" ] && saved_$name=\$$name" || true
  done
  . "$root/.apple-tv.env"
  for name in VELA_IPHONE VELA_APPLE_TEAM VELA_IOS_BUILD_DIR VELA_NATIVE_LOCK; do
    eval "[ -n \"\${saved_$name+set}\" ] && $name=\$saved_$name" || true
  done
fi
device=${VELA_IPHONE:-}
team=${VELA_APPLE_TEAM:-}
prebuild=0
simulator=0
open=""
usage="usage: tools/ios.sh [--prebuild] [--simulator] [--device <udid|name>] [--team <id>] [--open <vela://route>]"
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
build=${VELA_IOS_BUILD_DIR:-$root/.build/ios}
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
  # The only connected (or paired and available) physical iPhone, if there is exactly one.
  found=$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone/ && /physical/ && /available|connected/ {for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) print $i}')
  if [ "$(printf '%s\n' "$found" | grep -c .)" = 1 ]; then device=$found; fi
  if [ -z "$device" ]; then echo "ios: no single available iPhone; pass --device or set VELA_IPHONE (xcrun devicectl list devices)" >&2; exit 2; fi
fi
if [ "$simulator" = 0 ] && [ -z "$team" ]; then
  echo "ios: device builds need your team ID; pass --team or set VELA_APPLE_TEAM" >&2; exit 2
fi

project="$root/apps/vela/ios/Vela.xcodeproj/project.pbxproj"
# A project generated for tvOS (EXPO_TV=1) builds nothing for iPhone: regenerate it.
if [ -f "$project" ] && grep -q 'SDKROOT = appletvos' "$project"; then prebuild=1; fi
if [ "$prebuild" = 1 ] || [ ! -d "$root/apps/vela/ios" ]; then
  (cd "$root/apps/vela" && unset EXPO_TV && locked bun x expo prebuild -p ios --clean)
fi

cd "$root/apps/vela/ios"
# The generated project keeps the version it was generated with: the app's version is app.json's.
version=$(sed -n 's/^ *"version": "\([0-9.]*\)".*/\1/p' "$root/apps/vela/app.json" | head -1)
[ -n "$version" ] && /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" Vela/Info.plist
# A native module's new or removed files join the Pods project only through pod install.
if [ ! -f Pods/Manifest.lock ] || [ -n "$(find "$root/modules" -path '*/ios/*' -newer Pods/Manifest.lock -print -quit 2>/dev/null)" ]; then
  pod install >/dev/null
fi
if [ "$simulator" = 1 ]; then
  # Signed to run locally: an unsigned app has no Keychain, where the app keeps its sessions.
  set -- -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=""
  products=Release-iphonesimulator
else
  set -- -sdk iphoneos -destination 'generic/platform=iOS' -allowProvisioningUpdates DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Automatic
  products=Release-iphoneos
fi
if ! locked xcodebuild -workspace Vela.xcworkspace -scheme Vela -configuration Release -derivedDataPath "$derived" "$@" build >"$log" 2>&1; then
  grep -E "error:|Undefined symbols|The following build commands failed" -A3 "$log" | head -40
  echo "ios: build failed; the log is $log" >&2
  exit 1
fi
app=$derived/Build/Products/$products/Vela.app

if [ "$simulator" = 1 ]; then
  uuid='[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}'
  sim=$(xcrun simctl list devices booted | grep 'iPhone' | grep -oE "$uuid" | head -1)
  if [ -z "$sim" ]; then
    sim=$(xcrun simctl list devices available | grep 'iPhone' | grep -oE "$uuid" | head -1)
    [ -n "$sim" ] || { echo "ios: no iPhone simulator (Xcode > Settings > Platforms)" >&2; exit 2; }
    xcrun simctl boot "$sim"
  fi
  xcrun simctl install "$sim" "$app"
  echo "ios: installed $app on simulator $sim"
  if [ -n "$open" ]; then xcrun simctl openurl "$sim" "$open"; else xcrun simctl launch "$sim" app.ether.vela >/dev/null; fi
  exit 0
fi
xcrun devicectl device install app --device "$device" "$app" >/dev/null
echo "ios: installed $app"
if [ -n "$open" ]; then
  xcrun devicectl device process launch --device "$device" --terminate-existing --payload-url "$open" app.ether.vela >/dev/null
  echo "ios: opened $open"
else
  xcrun devicectl device process launch --device "$device" --terminate-existing app.ether.vela >/dev/null
  echo "ios: launched app.ether.vela"
fi
