#!/bin/sh
# Build apps/vela for iPhone (Release: the JS bundle is embedded, no Metro), sign it with your
# team's automatic provisioning, install it, and launch it or open a route.
#
#   tools/ios.sh [--prebuild] [--simulator] [--device <udid|name>] [--team <id>] [--open <vela://route>] [--no-launch]
#   tools/ios.sh --tour [<test>...] [--device <udid|name>] [--team <id>]
#
#   --prebuild   regenerate apps/vela/ios for iOS (expo prebuild --clean without EXPO_TV, then pod install)
#   --simulator  build for the iOS simulator and install on the booted (or first) iPhone simulator
#   --device     a paired iPhone; when omitted and exactly one is connected, that one is used
#   --team       your Apple developer team ID (device builds; see Xcode > Settings > Accounts)
#   --no-launch  install without opening Vela (the phone may be in use)
#   --tour       instead of installing, run the scripted UI tour (tools/ios-tour) on the device: it
#                taps through the app and saves a screenshot per step in <build dir>/tour/<time>/.
#                Name tests (test05MovieTitle) to run only those.
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
launch=1
tour=0
tests=""
usage="usage: tools/ios.sh [--prebuild] [--simulator] [--device <udid|name>] [--team <id>] [--open <vela://route>] [--no-launch] [--tour [<test>...]]"
while [ $# -gt 0 ]; do
  case "$1" in
    --prebuild) prebuild=1 ;;
    --simulator) simulator=1 ;;
    --device) device=$2; shift ;;
    --team) team=$2; shift ;;
    --open) open=$2; shift ;;
    --no-launch) launch=0 ;;
    --tour) tour=1 ;;
    test[0-9A-Z]*) [ "$tour" = 1 ] || { echo "$usage" >&2; exit 2; }; tests="$tests $1" ;;
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
if [ "$tour" = 1 ]; then
  # The UI-test target lives in tools/ios-tour and joins the generated project here.
  pods_gems=$(sed -n 's/^GEM_HOME="\([^"]*\)".*/\1/p' "$(command -v pod)" 2>/dev/null || true)
  GEM_HOME=${pods_gems:-${GEM_HOME:-}} ruby "$root/tools/ios-tour/add-target.rb" "$PWD" "$team"
  results=$build/tour/$(date +%Y%m%d-%H%M%S)
  mkdir -p "$results"
  set -- -workspace Vela.xcworkspace -scheme Vela -configuration Release -derivedDataPath "$derived" \
    -destination "id=$device" -allowProvisioningUpdates DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Automatic
  if ! locked xcodebuild "$@" build-for-testing >"$build/tour-build.log" 2>&1; then
    grep -E "error:|The following build commands failed" -A3 "$build/tour-build.log" | head -40
    echo "ios: tour build failed; the log is $build/tour-build.log" >&2
    exit 1
  fi
  [ -n "$tests" ] || tests=$(sed -n 's/^ *func \(test[0-9][0-9A-Za-z]*\)().*/\1/p' "$root/tools/ios-tour/VelaTour.swift")
  # One area at a time, each in its own run: a stalled accessibility snapshot (XCUITest asks the
  # app for its whole tree, thousands of elements here) costs one area, not the tour.
  failed=0
  for test in $tests; do
    out=$results/$test
    mkdir -p "$out"
    xcodebuild "$@" -test-timeouts-enabled YES -default-test-execution-time-allowance 240 -maximum-test-execution-time-allowance 300 \
      -resultBundlePath "$out/run.xcresult" -only-testing:"VelaTour/VelaTour/$test" test-without-building >"$out/run.log" 2>&1 &
    runner=$!
    size=0 quiet=0
    while kill -0 "$runner" 2>/dev/null; do
      sleep 5
      now=$(wc -c <"$out/run.log")
      if [ "$now" = "$size" ]; then quiet=$((quiet + 5)); else quiet=0 size=$now; fi
      if [ "$quiet" -ge 90 ]; then
        # Still drawing (the hero advances on its own) or frozen? Two screenshots tell.
        xcrun devicectl device capture screenshot --device "$device" --destination "$out/stall-1.png" >/dev/null 2>&1 || true
        sleep 4
        xcrun devicectl device capture screenshot --device "$device" --destination "$out/stall-2.png" >/dev/null 2>&1 || true
        if cmp -s "$out/stall-1.png" "$out/stall-2.png"; then state="its screen did not change in 4s"; else state="Vela is still drawing"; fi
        echo "ios: $test silent for 90s at: $(grep -v '^20[0-9][0-9]-' "$out/run.log" | tail -1 | sed 's/^ *//') ($state); stopping it"
        kill "$runner" 2>/dev/null || true
        break
      fi
    done
    wait "$runner" 2>/dev/null && result=passed || { result=failed; failed=1; }
    if [ -d "$out/run.xcresult" ] && xcrun xcresulttool export attachments --path "$out/run.xcresult" --output-path "$out" >/dev/null 2>&1; then
      # Name each exported file by its attachment (the step), from the manifest.
      (cd "$out" && /usr/bin/python3 -c '
import json, os
for test in json.load(open("manifest.json")):
    for a in test.get("attachments", []):
        src, name = a["exportedFileName"], a.get("suggestedHumanReadableName", "")
        if name and os.path.exists(src): os.rename(src, name.rsplit("_", 2)[0] + os.path.splitext(src)[1])
')
    fi
    echo "ios: $test $result, $(ls "$out" | grep -c '\.png$') screenshots in $out"
  done
  exit "$failed"
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
elif [ "$launch" = 1 ]; then
  xcrun devicectl device process launch --device "$device" --terminate-existing app.ether.vela >/dev/null
  echo "ios: launched app.ether.vela"
fi
