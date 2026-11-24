#!/usr/bin/env bash
# Set up and manage the budget Google TV floor emulator profile (`vela-tv-floor`) on gpu-workstation.
#
# Target hardware floor: budget Google TV stick (onn 4K / Chromecast with Google TV class:
# Amlogic S905Y4 / S905X2 quad-core Cortex-A55, 2 GB RAM, 1080p UI output).
#
# Safety invariants:
# - Never runs on macOS (exits immediately if uname != Linux).
# - Uses its own dedicated AVD (`vela-tv-floor`), console port (default 5584 -> `emulator-5584`),
#   and ADB server port (default 5041) so it never collides with other workers.
# - Records the exact PID it starts in `$PID_FILE` and stops ONLY that PID (never pkill/killall).
# - Boots the emulator at normal host speed so Android system services initialize reliably, then
#   applies the Cortex-A55 CPU quota (`systemctl --user set-property <unit> CPUQuota=...`, default
#   `100%` of one host Zen 5 core across the 4 guest vCPUs) once `sys.boot_completed=1`.
#
# Usage:
#   bash tools/perf/emulator-floor.sh setup
#   bash tools/perf/emulator-floor.sh start [--port 5584] [--cpu-quota 100%]
#   bash tools/perf/emulator-floor.sh status [--port 5584]
#   bash tools/perf/emulator-floor.sh stop [--port 5584]

set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "error: tools/perf/emulator-floor.sh must run on gpu-workstation (Linux), never on macOS." >&2
  exit 1
fi

ACTION="${1:-status}"
shift || true

PORT="${VELA_TV_FLOOR_PORT:-5584}"
CPU_QUOTA="${VELA_TV_FLOOR_CPU_QUOTA:-100%}"
ALLOWED_CPUS="${VELA_TV_FLOOR_CPUS:-0-3}"
AVD_NAME="vela-tv-floor"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --cpu-quota) CPU_QUOTA="$2"; shift 2 ;;
    --cpus) ALLOWED_CPUS="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/.scratch/android-sdk}"
export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$HOME/.scratch/android-avd}"
export ANDROID_ADB_SERVER_PORT="${ANDROID_ADB_SERVER_PORT:-5041}"

ADB="$ANDROID_SDK_ROOT/platform-tools/adb"
EMULATOR="$ANDROID_SDK_ROOT/emulator/emulator"
SERIAL="emulator-${PORT}"
UNIT_NAME="vela-tv-floor-${PORT}"
ADB_UNIT_NAME="vela-tv-floor-adb-${ANDROID_ADB_SERVER_PORT}"

WORK_DIR="${VELA_TV_FLOOR_DIR:-$HOME/.scratch/tmp/vela-tv-floor}"
mkdir -p "$WORK_DIR"
PID_FILE="$WORK_DIR/emulator-${PORT}.pid"
LOG_FILE="$WORK_DIR/emulator-${PORT}.log"

ensure_adb_server() {
  if ! "$ADB" devices >/dev/null 2>&1; then
    systemctl --user stop "$ADB_UNIT_NAME" >/dev/null 2>&1 || true
    systemctl --user reset-failed "$ADB_UNIT_NAME" >/dev/null 2>&1 || true
    systemd-run --user --unit="$ADB_UNIT_NAME" \
      --setenv="ANDROID_SDK_ROOT=${ANDROID_SDK_ROOT}" \
      --setenv="ANDROID_AVD_HOME=${ANDROID_AVD_HOME}" \
      --setenv="ANDROID_ADB_SERVER_PORT=${ANDROID_ADB_SERVER_PORT}" \
      "$ADB" -L "tcp:${ANDROID_ADB_SERVER_PORT}" nodaemon server >/dev/null 2>&1 || true
    sleep 1
  fi
}

setup_avd() {
  local base_avd="$ANDROID_AVD_HOME/vela-tv.avd"
  local target_avd="$ANDROID_AVD_HOME/${AVD_NAME}.avd"
  local target_ini="$ANDROID_AVD_HOME/${AVD_NAME}.ini"

  if [[ ! -d "$base_avd" ]]; then
    echo "error: base AVD $base_avd not found on gpu-workstation" >&2
    exit 1
  fi

  mkdir -p "$target_avd"

  cat > "$target_ini" <<EOF
avd.ini.encoding=UTF-8
path=$target_avd
path.rel=avd/${AVD_NAME}.avd
target=android-36
EOF

  cat > "$target_avd/config.ini" <<EOF
AvdId=${AVD_NAME}
PlayStore.enabled=false
abi.type=x86_64
avd.ini.displayname=Vela TV Floor (2GB 4xA55 1080p)
avd.ini.encoding=UTF-8
disk.dataPartition.size=4096M
fastboot.forceColdBoot=yes
hw.accelerometer=no
hw.arc=false
hw.audioInput=no
hw.battery=no
hw.camera.back=none
hw.camera.front=none
hw.cpu.arch=x86_64
hw.cpu.ncore=4
hw.dPad=yes
hw.device.hash2=MD5:6d78ef4ce0b0dd3c1d3e9d33bfac89a5
hw.device.manufacturer=Google
hw.device.name=tv_1080p
hw.gps=no
hw.gpu.enabled=yes
hw.gpu.mode=swiftshader_indirect
hw.initialOrientation=landscape
hw.keyboard=yes
hw.keyboard.lid=no
hw.lcd.density=320
hw.lcd.height=1080
hw.lcd.width=1920
hw.mainKeys=yes
hw.ramSize=2048
hw.sdCard=no
hw.sensors.orientation=no
hw.sensors.proximity=no
hw.trackBall=no
image.sysdir.1=system-images/android-36/android-tv/x86_64/
runtime.network.latency=none
runtime.network.speed=full
sdcard.size=512M
showDeviceFrame=no
skin.dynamic=yes
skin.name=1920x1080
skin.path=_no_skin
tag.display=Android TV
tag.id=android-tv
vm.heapSize=256
EOF

  if [[ -f "$base_avd/userdata.img" && ! -f "$target_avd/userdata.img" ]]; then
    cp "$base_avd/userdata.img" "$target_avd/userdata.img"
  fi
  if [[ -f "$base_avd/encryptionkey.img" && ! -f "$target_avd/encryptionkey.img" ]]; then
    cp "$base_avd/encryptionkey.img" "$target_avd/encryptionkey.img"
  fi

  echo "Configured AVD ${AVD_NAME} at ${target_avd} (1920x1080@320dpi, 2048MB RAM, 4 cores)"
}

is_running() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

start_emulator() {
  setup_avd
  ensure_adb_server
  if is_running; then
    echo "Emulator ${SERIAL} is already running (PID $(cat "$PID_FILE"))"
    return 0
  fi

  rm -f "$ANDROID_AVD_HOME/${AVD_NAME}.avd/"*.lock 2>/dev/null || true

  echo "Starting ${AVD_NAME} on ${SERIAL} (2048 MB RAM, 4 cores, AllowedCPUs=${ALLOWED_CPUS}; throttling to CPUQuota=${CPU_QUOTA} after boot)..."

  systemctl --user stop "$UNIT_NAME" >/dev/null 2>&1 || true
  systemctl --user reset-failed "$UNIT_NAME" >/dev/null 2>&1 || true

  # Boot unthrottled (CPUQuota=400%) on the 4 pinned CPUs so Android OS services finish startup cleanly,
  # then dial down to CPUQuota=${CPU_QUOTA} once boot completes.
  systemd-run --user --unit="$UNIT_NAME" \
    --setenv="ANDROID_SDK_ROOT=${ANDROID_SDK_ROOT}" \
    --setenv="ANDROID_AVD_HOME=${ANDROID_AVD_HOME}" \
    --setenv="ANDROID_ADB_SERVER_PORT=${ANDROID_ADB_SERVER_PORT}" \
    -p "CPUQuota=400%" \
    -p "AllowedCPUs=${ALLOWED_CPUS}" \
    /bin/bash -c "exec \"$EMULATOR\" -avd \"$AVD_NAME\" -port \"$PORT\" -no-window -no-audio -no-snapshot -no-boot-anim -gpu swiftshader_indirect -memory 2048 -cores 4 >\"$LOG_FILE\" 2>&1"

  sleep 1
  local emu_pid
  emu_pid="$(systemctl --user show -p MainPID --value "$UNIT_NAME" 2>/dev/null || true)"
  if [[ -z "$emu_pid" || "$emu_pid" == "0" ]]; then
    echo "error: failed to get MainPID for systemd unit ${UNIT_NAME}" >&2
    exit 1
  fi
  echo "$emu_pid" > "$PID_FILE"
  echo "Launched ${SERIAL} with PID ${emu_pid}. Waiting for boot completion..."

  local elapsed=0
  local timeout=180
  while (( elapsed < timeout )); do
    if ! kill -0 "$emu_pid" 2>/dev/null; then
      echo "error: emulator process ${emu_pid} exited prematurely. Last log lines:" >&2
      tail -n 40 "$LOG_FILE" >&2 || true
      exit 1
    fi
    local boot_completed
    boot_completed="$(timeout 5 "$ADB" -s "$SERIAL" shell getprop sys.boot_completed < /dev/null 2>/dev/null | tr -d '\r\n' || true)"
    if [[ "$boot_completed" == "1" ]]; then
      break
    fi
    sleep 2
    (( elapsed += 2 ))
  done

  if (( elapsed >= timeout )); then
    echo "error: timed out waiting for ${SERIAL} to finish booting" >&2
    exit 1
  fi

  # Enforce 1920x1080 @ 320 dpi and disable system window animations for deterministic frame timings.
  timeout 10 "$ADB" -s "$SERIAL" shell wm size 1920x1080 < /dev/null >/dev/null 2>&1 || true
  timeout 10 "$ADB" -s "$SERIAL" shell wm density 320 < /dev/null >/dev/null 2>&1 || true
  timeout 10 "$ADB" -s "$SERIAL" shell settings put global window_animation_scale 0 < /dev/null >/dev/null 2>&1 || true
  timeout 10 "$ADB" -s "$SERIAL" shell settings put global transition_animation_scale 0 < /dev/null >/dev/null 2>&1 || true
  timeout 10 "$ADB" -s "$SERIAL" shell settings put global animator_duration_scale 0 < /dev/null >/dev/null 2>&1 || true

  # Apply the Cortex-A55 CPU quota now that the guest OS is booted.
  echo "Applying Cortex-A55 CPU throttle: systemctl --user set-property ${UNIT_NAME}.service CPUQuota=${CPU_QUOTA}"
  systemctl --user set-property "${UNIT_NAME}.service" "CPUQuota=${CPU_QUOTA}"

  echo "Ready: ${SERIAL} (PID ${emu_pid}, CPUQuota=${CPU_QUOTA})"
  status_emulator
}

status_emulator() {
  ensure_adb_server
  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    echo "RUNNING: ${SERIAL} (PID ${pid})"
    timeout 10 "$ADB" -s "$SERIAL" shell "wm size; wm density; grep -E 'MemTotal|processor' /proc/meminfo /proc/cpuinfo" < /dev/null 2>/dev/null || true
    systemctl --user show -p CPUQuotaPerSecUSec,AllowedCPUs "${UNIT_NAME}.service" 2>/dev/null || true
  else
    echo "STOPPED: ${SERIAL}"
  fi
}

stop_emulator() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]]; then
      echo "Stopping ${SERIAL} (owned PID ${pid})..."
      timeout 5 "$ADB" -s "$SERIAL" emu kill < /dev/null >/dev/null 2>&1 || true

      local waited=0
      while kill -0 "$pid" 2>/dev/null && (( waited < 10 )); do
        sleep 1
        (( waited += 1 ))
      done

      if kill -0 "$pid" 2>/dev/null; then
        kill -TERM "$pid" 2>/dev/null || true
        sleep 2
      fi
      if kill -0 "$pid" 2>/dev/null; then
        kill -KILL "$pid" 2>/dev/null || true
      fi
    fi
    rm -f "$PID_FILE"
  fi

  systemctl --user stop "$UNIT_NAME" >/dev/null 2>&1 || true
  systemctl --user reset-failed "$UNIT_NAME" >/dev/null 2>&1 || true
  systemctl --user stop "$ADB_UNIT_NAME" >/dev/null 2>&1 || true
  systemctl --user reset-failed "$ADB_UNIT_NAME" >/dev/null 2>&1 || true

  rm -f "$ANDROID_AVD_HOME/${AVD_NAME}.avd/"*.lock 2>/dev/null || true
  echo "Stopped ${SERIAL}."
}

case "$ACTION" in
  setup) setup_avd ;;
  start) start_emulator ;;
  status) status_emulator ;;
  stop) stop_emulator ;;
  *)
    echo "Usage: $0 {setup|start|status|stop} [--port 5584] [--cpu-quota 100%] [--cpus 0-3]" >&2
    exit 1
    ;;
esac
