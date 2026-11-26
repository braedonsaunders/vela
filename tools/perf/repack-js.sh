#!/bin/bash
# Measurement APK for a JS-only change: a production Hermes bundle of this tree swapped into a release
# APK whose native code matches, re-signed with a throwaway key. About a minute instead of a Gradle build.
#
#   tools/perf/repack-js.sh <base.apk> <out.apk> [--probe]
#
# --probe builds an unminified bundle with the React commit probe (tools/perf/probe), for counting
# re-renders; leave it off for CPU and latency numbers. EXPO_PUBLIC_VELA_SERVER/USER/PASSWORD (or
# EXPO_PUBLIC_VELA_MOCK=1) from the caller's environment sign the build in: such an APK holds the
# credentials, so keep it under ~/.scratch and delete it when done. Needs Bun, ANDROID_HOME with
# build-tools, python3 and keytool. The installed release must be uninstalled first (other key).
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
base=$1 out=$2 probe=0
[ "${3:-}" = --probe ] && probe=1
work=$(mktemp -d "${TMPDIR:-/tmp}/vela-repack.XXXXXX")
trap 'rm -rf "$work"' EXIT
case "$(uname -s)" in Darwin) hermes=osx-bin ;; *) hermes=linux64-bin ;; esac
minify=true
[ "$probe" = 1 ] && minify=false
(cd "$root/apps/vela" && EXPO_NO_DOTENV=1 NODE_ENV=production VELA_PERF_PROBE=$probe \
  bun x expo export:embed --platform android --dev false --minify $minify --reset-cache \
  --bundle-output "$work/index.android.bundle" --assets-dest "$work/res" >"$work/metro.log" 2>&1) \
  || { tail -30 "$work/metro.log" >&2; exit 1; }
"$root/node_modules/hermes-compiler/hermesc/$hermes/hermesc" -emit-binary -O -w \
  -out "$work/index.android.bundle.hbc" "$work/index.android.bundle"
python3 - "$base" "$work/unsigned.apk" "$work/index.android.bundle.hbc" <<'EOF'
import sys, zipfile
base, out, bundle = sys.argv[1:]
with zipfile.ZipFile(base) as src, zipfile.ZipFile(out, 'w') as dst:
    for item in src.infolist():
        if item.filename.startswith('META-INF/') or item.filename == 'assets/index.android.bundle':
            continue
        dst.writestr(item, src.read(item.filename))
    dst.write(bundle, 'assets/index.android.bundle', compress_type=zipfile.ZIP_STORED)
EOF
tools=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
key="$HOME/.scratch/vela-perf-key.jks"
[ -f "$key" ] || keytool -genkeypair -keystore "$key" -storepass velaperf -keypass velaperf -alias perf \
  -keyalg RSA -keysize 2048 -validity 3650 -dname CN=vela-perf >/dev/null 2>&1
"$tools/zipalign" -f -p 4 "$work/unsigned.apk" "$work/aligned.apk"
"$tools/apksigner" sign --ks "$key" --ks-pass pass:velaperf --key-pass pass:velaperf --out "$out" "$work/aligned.apk"
# A probe bundle's source stays beside the APK: the probe names timer callbacks by bundle line.
[ "$probe" = 1 ] && cp "$work/index.android.bundle" "${out%.apk}.bundle.js"
echo "repack-js: $out ($( [ "$probe" = 1 ] && echo probe || echo release ) bundle)"
