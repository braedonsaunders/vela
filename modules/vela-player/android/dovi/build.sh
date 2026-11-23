#!/usr/bin/env bash
# Build libdovi (quietvoid/dovi_tool's dolby_vision crate, MIT) as a static archive for each Android ABI.
# Vela links it into libvela_dovi.so to convert Dolby Vision Profile 7 RPUs to 8.1 (DolbyVision.kt).
# Output and pinned source stay under ~/.scratch; the Rust toolchain is private to this build unless
# VELA_RUSTUP_HOME/VELA_CARGO_HOME name another. Run on the Android build host before Gradle.
set -euo pipefail
ANDROID_HOME="${ANDROID_HOME:-$HOME/.scratch/android-sdk}"
version=3.4.0
revision=d1abe0e27ff2c7ab3339614d06db9f8a058af6b2
toolchain=1.90.0
work="$HOME/.scratch/vela-build/dovi/$version"
export RUSTUP_HOME="${VELA_RUSTUP_HOME:-$HOME/.scratch/vela-build/rust/rustup}"
export CARGO_HOME="${VELA_CARGO_HOME:-$HOME/.scratch/vela-build/rust/cargo}"
export PATH="$CARGO_HOME/bin:$PATH"
if [ ! -x "$CARGO_HOME/bin/rustup" ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain none
fi
rustup toolchain install "$toolchain" --profile minimal \
  --target aarch64-linux-android --target armv7-linux-androideabi --target x86_64-linux-android
if [ ! -d "$work/src/.git" ]; then
  git clone --depth 1 --branch "libdovi-$version" https://github.com/quietvoid/dovi_tool.git "$work/src"
fi
[ "$(git -C "$work/src" rev-parse HEAD)" = "$revision" ] || { echo 'Unexpected libdovi revision' >&2; exit 1; }
ndk="$ANDROID_HOME/ndk/27.1.12297006"
case $(uname -s) in Darwin) host=darwin-x86_64 ;; *) host=linux-x86_64 ;; esac
bin="$ndk/toolchains/llvm/prebuilt/$host/bin"
for abi in armeabi-v7a arm64-v8a x86_64; do
  case $abi in
    armeabi-v7a) target=armv7-linux-androideabi; clang=armv7a-linux-androideabi26-clang ;;
    arm64-v8a) target=aarch64-linux-android; clang=aarch64-linux-android26-clang ;;
    x86_64) target=x86_64-linux-android; clang=x86_64-linux-android26-clang ;;
  esac
  key=$(echo "$target" | tr '[:lower:]-' '[:upper:]_')
  export "CARGO_TARGET_${key}_LINKER=$bin/$clang" "CC_${target//-/_}=$bin/$clang" "AR_${target//-/_}=$bin/llvm-ar"
  (cd "$work/src/dolby_vision" && cargo "+$toolchain" rustc --release --locked --features capi --crate-type staticlib \
    --target "$target" --target-dir "$work/target" -- -C panic=abort -C strip=debuginfo)
  mkdir -p "$work/$abi"
  cp "$work/target/$target/release/libdolby_vision.a" "$work/$abi/"
done
echo "libdovi $version archives in $work/<abi>/libdolby_vision.a"
