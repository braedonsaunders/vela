#!/bin/bash
# Start the Android TV emulator headless and wait until it has booted; print its serial.
#
#   tools/android-emulator.sh [avd]      (default vela-tv; tools/android-env.sh's ANDROID_AVD_HOME)
#
# Rendering is ANGLE on SwiftShader (swangle_indirect): on a machine without a usable host GPU (WSL2,
# servers) the default SwiftShader GLES translator segfaults the emulator on Vela's title page, and
# -gpu host needs a display. Stop it with `adb -s <serial> emu kill`.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
avd=${1:-vela-tv}

cd "$root"
# shellcheck source=android-env.sh
source tools/android-env.sh
log="$(dirname "$GRADLE_USER_HOME")/emulator-$avd.log"

before=$(adb devices | awk '/^emulator-/ { print $1 }')
nohup emulator -avd "$avd" -no-window -no-snapshot -no-boot-anim -gpu swangle_indirect >"$log" 2>&1 &
pid=$!

serial=""
for _ in $(seq 120); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "android-emulator: the emulator exited; the log is $log" >&2
    exit 1
  fi
  for candidate in $(adb devices | awk '/^emulator-/ { print $1 }'); do
    if ! grep -qx "$candidate" <<<"$before"; then
      serial=$candidate
    fi
  done
  if [ -n "$serial" ] && [ "$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then
    echo "$serial"
    exit 0
  fi
  sleep 5
done
echo "android-emulator: no boot after 10 minutes; the log is $log" >&2
exit 1
