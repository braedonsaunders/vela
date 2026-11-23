#!/bin/sh
# Archive apps/vela for Apple TV and for iPhone and iPad, sign it for the App Store, upload it to
# App Store Connect and hand it to TestFlight: the internal group at once, the public link after
# Beta App Review. Prints the version and build number of what it uploaded.
#
#   tools/testflight.sh [--platform tvos|ios] [--build-number <n>] [--no-upload] [--no-distribute]
#                       [--internal-only] [--whats-new <file>]
#
#   --platform       only this platform (default: both, tvOS first)
#   --build-number   CFBundleVersion for both platforms (default: tools/release/asc.ts next-build:
#                    Android's versionCode for a new version, then <versionCode>.1, .2 ...)
#   --no-upload      archive and export an .ipa into the build directory without uploading
#   --no-distribute  upload, but leave TestFlight groups and Beta App Review alone
#   --internal-only  give the builds to the internal group only; no Beta App Review submission
#   --whats-new      "What to Test" text for these builds (default: tools/testflight/beta.json)
#
# Needs an App Store Connect API key (Admin: export uses cloud-managed distribution signing) in
# ~/.config/vela-release/asc.env as ASC_ISSUER_ID, ASC_KEY_ID and ASC_PRIVATE_KEY, and the app record
# for app.ether.vela in App Store Connect. Test information that is personal lives in
# ~/.config/vela-release/testflight.env. See docs/distribution.md, "TestFlight".
#
# Defaults may live in .apple-tv.env at the repository root (gitignored; the environment wins):
#   VELA_APPLE_TEAM=<team id>
#   VELA_TESTFLIGHT_BUILD_DIR=<directory for archives, DerivedData and logs>   (default: .build/testflight)
#   VELA_NATIVE_LOCK=<lock file shared with other native builds> (optional)
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
if [ -f "$root/.apple-tv.env" ]; then
  for name in VELA_APPLE_TEAM VELA_TESTFLIGHT_BUILD_DIR VELA_NATIVE_LOCK; do
    eval "[ -n \"\${$name:-}\" ] && saved_$name=\$$name" || true
  done
  . "$root/.apple-tv.env"
  for name in VELA_APPLE_TEAM VELA_TESTFLIGHT_BUILD_DIR VELA_NATIVE_LOCK; do
    eval "[ -n \"\${saved_$name+set}\" ] && $name=\$saved_$name" || true
  done
fi
team=${VELA_APPLE_TEAM:-9YL3YCJTNT}
platforms="tvos ios"
number=""
upload=1
distribute=1
internal_only=""
whats_new=""
usage="usage: tools/testflight.sh [--platform tvos|ios] [--build-number <n>] [--no-upload] [--no-distribute] [--internal-only] [--whats-new <file>]"
while [ $# -gt 0 ]; do
  case "$1" in
    --platform) case "$2" in tvos|ios) platforms=$2 ;; *) echo "$usage" >&2; exit 2 ;; esac; shift ;;
    --build-number) number=$2; shift ;;
    --no-upload) upload=0; distribute=0 ;;
    --no-distribute) distribute=0 ;;
    --internal-only) internal_only=--internal-only ;;
    --whats-new) whats_new=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift ;;
    -h|--help) echo "$usage"; exit 0 ;;
    *) echo "$usage" >&2; exit 2 ;;
  esac
  shift
done
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
export LANG=en_US.UTF-8
[ -d "$root/.tools/bun-darwin-aarch64" ] && export PATH="$root/.tools/bun-darwin-aarch64:$PATH"
build=${VELA_TESTFLIGHT_BUILD_DIR:-$root/.build/testflight}
derived=$build/derived
mkdir -p "$build/tmp"
# Metro keeps its cache under TMPDIR: one per checkout, so a bundle never resolves another checkout's files.
export TMPDIR="$build/tmp/"
# A store build runs standalone: no lab server, account or mock baked into the bundle.
unset EXPO_PUBLIC_VELA_SERVER EXPO_PUBLIC_VELA_USER EXPO_PUBLIC_VELA_PASSWORD EXPO_PUBLIC_VELA_MOCK
export EXPO_NO_DOTENV=1

locked() {
  if [ -n "${VELA_NATIVE_LOCK:-}" ]; then
    mkdir -p "$(dirname "$VELA_NATIVE_LOCK")"
    perl -MFcntl=:flock -e 'open(my $f,">>",shift);flock($f,LOCK_EX);my $p=fork();if(!$p){exec @ARGV}waitpid($p,0);exit($?>>8)' "$VELA_NATIVE_LOCK" "$@"
  else
    "$@"
  fi
}
asc() { bun "$root/tools/release/asc.ts" "$@"; }

# The API key signs and uploads. xcodebuild reads it from a file: asc.ts writes the .p8 (0600) beside
# asc.env and prints the path, key ID and issuer, which stay in variables and are never echoed.
key_path="" key_id="" key_issuer=""
if key=$(asc key-file); then
  key_path=$(printf '%s\n' "$key" | sed -n 1p)
  key_id=$(printf '%s\n' "$key" | sed -n 2p)
  key_issuer=$(printf '%s\n' "$key" | sed -n 3p)
elif [ "$upload" = 1 ]; then
  exit 1
fi
auth() {
  echo -allowProvisioningUpdates
  [ -z "$key_path" ] || printf '%s\n' -authenticationKeyPath "$key_path" -authenticationKeyID "$key_id" -authenticationKeyIssuerID "$key_issuer"
}

version=$(sed -n 's/^ *"version": "\([0-9.]*\)".*/\1/p' "$root/apps/vela/app.json" | head -1)
[ "$upload" = 1 ] && asc setup
if [ -z "$number" ]; then
  if [ -n "$key_path" ]; then number=$(asc next-build "$version")
  else number=$(sed -n 's/^ *"versionCode": \([0-9]*\).*/\1/p' "$root/apps/vela/app.json" | head -1); fi
fi
echo "testflight: Vela $version ($number)"

# libass (ASS/SSA as authored) is built once per checkout; the podspec picks it up at pod install.
if [ ! -d "$root/modules/vela-player/ios/ass/build/Libass.xcframework" ]; then
  locked "$root/modules/vela-player/ios/ass/build.sh" --work "$build/libass"
fi

method=app-store-connect
destination=upload
[ "$upload" = 1 ] || destination=export
options=$build/ExportOptions.plist
cat >"$options" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>$method</string>
<key>destination</key><string>$destination</string>
<key>teamID</key><string>$team</string>
<key>signingStyle</key><string>automatic</string>
<key>uploadSymbols</key><true/>
<key>manageAppVersionAndBuildNumber</key><false/>
<key>testFlightInternalTestingOnly</key><false/>
</dict></plist>
EOF

uploaded=""
for platform in $platforms; do
  if [ "$platform" = tvos ]; then tv=1 generic='generic/platform=tvOS' asc_platform=TV_OS
  else tv=0 generic='generic/platform=iOS' asc_platform=IOS; fi
  log=$build/$platform-archive.log
  archive=$build/Vela-$version-$number-$platform.xcarchive
  # A clean project for the platform every time: apps/vela/ios is generated for one platform at a time.
  if [ "$tv" = 1 ]; then
    (cd "$root/apps/vela" && EXPO_TV=1 locked bun x expo prebuild -p ios --clean) >"$build/$platform-prebuild.log" 2>&1
  else
    (cd "$root/apps/vela" && unset EXPO_TV && locked bun x expo prebuild -p ios --clean) >"$build/$platform-prebuild.log" 2>&1
  fi || { tail -20 "$build/$platform-prebuild.log"; echo "testflight: $platform prebuild failed; the log is $build/$platform-prebuild.log" >&2; exit 1; }
  plist=$root/apps/vela/ios/Vela/Info.plist
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" -c "Set :CFBundleVersion $number" "$plist"
  rm -rf "$archive"
  # shellcheck disable=SC2046
  if ! (cd "$root/apps/vela/ios" && locked xcodebuild -workspace Vela.xcworkspace -scheme Vela -configuration Release \
      -destination "$generic" -derivedDataPath "$derived/$platform" -archivePath "$archive" \
      $(auth) DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Automatic archive) >"$log" 2>&1; then
    grep -E "error:|Undefined symbols|The following build commands failed" -A3 "$log" | head -40
    echo "testflight: $platform archive failed; the log is $log" >&2
    exit 1
  fi
  log=$build/$platform-export.log
  rm -rf "$build/export-$platform"
  # shellcheck disable=SC2046
  if ! locked xcodebuild -exportArchive -archivePath "$archive" -exportPath "$build/export-$platform" \
      -exportOptionsPlist "$options" $(auth) >"$log" 2>&1; then
    grep -E "error|Error|ITMS-|failed" "$log" | grep -v '^ *$' | head -40
    echo "testflight: $platform export/upload failed; the log is $log" >&2
    exit 1
  fi
  if [ "$upload" = 1 ]; then
    echo "testflight: uploaded $platform Vela $version ($number)"
    uploaded="$uploaded --platform $asc_platform"
  else
    echo "testflight: exported $(ls "$build/export-$platform"/*.ipa)"
  fi
done

if [ "$distribute" = 1 ] && [ -n "$uploaded" ]; then
  # shellcheck disable=SC2086
  asc distribute "$version" "$number" $uploaded $internal_only ${whats_new:+--whats-new "$whats_new"}
fi
[ -z "$uploaded" ] || echo "testflight: Vela $version build $number uploaded for$(printf '%s' "$uploaded" | sed 's/ --platform//g')"
