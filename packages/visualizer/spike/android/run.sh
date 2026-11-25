#!/usr/bin/env bash
# Build and run the Android visualizer spike on a Linux worker, from a Mac checkout.
# Set VIZ_HOST to the SSH destination and VIZ_TASK to this run’s scratch directory name.
#   run.sh build                 bundle viz-native.js (ink, tunnel), sync, assemble the release APK on the worker
#   run.sh emulator              start this spike's own headless Android TV emulator (API 36) on the worker
#   run.sh install               install the APK, push the track (never committed), mute the music stream
#   run.sh measure <scene> <s> [gpuFinish]   run one scene for <s> seconds, save its logcat and a screenshot
#   run.sh stop                  stop the owned emulator and this spike's adb server
# Everything bulky lives under ~/.scratch/tmp/$TASK on both machines.
set -euo pipefail
HOST=${VIZ_HOST:?Set VIZ_HOST to the SSH destination}
TASK=${VIZ_TASK:-${BB_THREAD_ID:-vizspike}}
HERE=$(cd "$(dirname "$0")" && pwd)
VIZ=$(cd "$HERE/../.." && pwd)
LOCAL=~/.scratch/tmp/$TASK
R=".scratch/tmp/$TASK"                            # relative to the worker's home
ADB_PORT=${VIZ_ADB_PORT:-5099}
EMU_PORT=${VIZ_EMU_PORT:-5740}
[[ "$TASK" =~ ^[[:alnum:]_-]+$ && "$ADB_PORT" =~ ^[0-9]+$ && "$EMU_PORT" =~ ^[0-9]+$ ]] || exit 2
ABIS=${VIZ_ABIS:-x86_64,arm64-v8a}
[[ "$ABIS" =~ ^(x86_64|arm64-v8a)(,(x86_64|arm64-v8a))*$ ]] || exit 2
DEV=emulator-$EMU_PORT
remote() { ssh "$HOST" "set -eu; export JAVA_HOME=\$HOME/.scratch/jdk17 ANDROID_HOME=\$HOME/.scratch/android-sdk ANDROID_SDK_ROOT=\$HOME/.scratch/android-sdk ANDROID_AVD_HOME=\$HOME/$R/avd ANDROID_ADB_SERVER_PORT=$ADB_PORT; A=\"\$ANDROID_HOME/platform-tools/adb -P $ADB_PORT -s $DEV\"; $1"; }

case "${1:-}" in
  build)
    bun "$VIZ/tools/build.ts" --scenes ink,tunnel --out "$HERE/app/src/main/assets"
    ssh "$HOST" "mkdir -p $R/vizspike $R/media"
    rsync -az --delete --exclude .gradle --exclude build --exclude app/build --exclude app/.cxx --exclude local.properties "$HERE/" "$HOST:$R/vizspike/"
    remote "cd $R/vizspike && echo sdk.dir=\$ANDROID_HOME > local.properties && \$HOME/.gradle/wrapper/dists/gradle-9.4.1-bin/*/gradle-9.4.1/bin/gradle --no-daemon -q -PvizAbis=$ABIS assembleRelease"
    ;;
  emulator)
    # A fresh server and console port keep this run isolated from other workers.
    remote "for port in $ADB_PORT $EMU_PORT $((EMU_PORT + 1)); do test -z \"\$(ss -Hltn sport = :\$port)\" || { echo port \$port in use >&2; exit 1; }; done
      mkdir -p \$ANDROID_AVD_HOME && cd $R && ( [ -d \$ANDROID_AVD_HOME/vizspike-tv.avd ] || { echo no | \$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager create avd -n vizspike-tv -k 'system-images;android-36;android-tv;x86_64' -d tv_1080p --force >/dev/null; sed -i 's/^hw.ramSize=.*/hw.ramSize=2048/' \$ANDROID_AVD_HOME/vizspike-tv.avd/config.ini; } )
      \$ANDROID_HOME/platform-tools/adb -P $ADB_PORT start-server
      # Audio enabled in the guest (a real AudioTrack), discarded on the host; the tap outputs silence anyway.
      QEMU_AUDIO_DRV=none nohup \$ANDROID_HOME/emulator/emulator -avd vizspike-tv -port $EMU_PORT -no-window -no-boot-anim -gpu swangle_indirect -feature -HardwareDecoder -no-snapshot -memory 2048 -cores 4 > emu.log 2>&1 < /dev/null & echo \$! > emu.pid
      for i in \$(seq 1 60); do [ \"\$(\$A shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')\" = 1 ] && break; sleep 5; done; \$A shell getprop sys.boot_completed"
    ;;
  install)
    rsync -az "$LOCAL/media/track.mp3" "$HOST:$R/media/"
    remote "\$A install -r $R/vizspike/app/build/outputs/apk/release/app-release.apk && \$A shell mkdir -p /sdcard/Android/data/app.vela.vizspike/files && \$A push $R/media/track.mp3 /sdcard/Android/data/app.vela.vizspike/files/track.mp3 && \$A shell cmd media_session volume --stream 3 --set 0 && \$A shell settings put system screen_off_timeout 2147483647"
    ;;
  measure)
    scene=${2:-ink}; secs=${3:-75}; finish=${4:-false}
    tag=$scene
    if [ "$finish" = true ]; then tag="$scene-finish"; fi
    [[ "$scene" =~ ^(ink|tunnel)$ && "$secs" =~ ^[0-9]+$ && "$finish" =~ ^(true|false)$ ]] || exit 2
    mkdir -p "$LOCAL/shots" "$LOCAL/logs"
    remote "trap '\$A shell am force-stop app.vela.vizspike' EXIT; \$A shell am force-stop app.vela.vizspike; \$A logcat -c; \$A shell am start -n app.vela.vizspike/.MainActivity --es scene $scene --ez gpuFinish $finish >/dev/null; sleep $secs; \$A exec-out screencap -p > $R/shot-$tag.png; \$A logcat -d -v time -s VizSpike:V VizJS:V VizExec:V AndroidRuntime:E > $R/log-$tag.txt"
    scp -q "$HOST:$R/shot-$tag.png" "$LOCAL/shots/$tag.png"
    scp -q "$HOST:$R/log-$tag.txt" "$LOCAL/logs/$tag.txt"
    "$HERE/summarise.sh" "$LOCAL/logs/$tag.txt"
    echo "screenshot: $LOCAL/shots/$tag.png"
    ;;
  stop)
    remote "cd $R
      pid=\$(cat emu.pid)
      test \"\$(readlink /proc/\$pid/cwd)\" = \"\$(pwd -P)\"
      test \"\$(\$A emu avd name | tr -d '\r' | head -1)\" = vizspike-tv
      \$A emu kill
      for i in \$(seq 1 30); do [ -d /proc/\$pid ] || break; sleep 1; done
      test ! -d /proc/\$pid
      \$ANDROID_HOME/platform-tools/adb -P $ADB_PORT kill-server"
    ;;
  *) sed -n '2,8p' "$0"; exit 1 ;;
esac
