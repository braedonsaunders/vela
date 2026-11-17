#!/bin/bash -e
# Builds libmpv for Android under the LGPL, from mpv-android's build scripts as packaged by
# libmpv-android (pinned below), for arm64-v8a and/or x86_64. The published AAR (dev.jdtech.mpv:libmpv) is GPLv3:
# its FFmpeg is configured with --enable-gpl and its mpv keeps the GPL default. This build drops
# --enable-gpl (FFmpeg stays --enable-version3 for mbedTLS, so it is LGPLv3) and sets -Dgpl=false.
#
# Output: ~/.scratch/vela-build/libmpv/<revision>-lgpl/{include,jniLibs/<abi>}, which the module's
# Gradle build links against. Sources and intermediate prefixes stay beside it on the scratch drive.
#
# Linux host tools: autoconf, automake, libtool, pkg-config, ninja, nasm, gperf, Python venv.
# Successful dependency builds are reused when retrying an interrupted build.
# Usage: source tools/android-env.sh; modules/vela-player/android/libmpv/build.sh [arm64 [x86_64]]

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$here/pin.sh"

archs=("$@")
[ ${#archs[@]} -eq 0 ] && archs=(arm64)

if [ -z "$ANDROID_HOME" ] || [ -z "$JAVA_HOME" ]; then
  echo >&2 "Source tools/android-env.sh first."
  exit 1
fi

work="$HOME/.scratch/vela-build/libmpv"
src="$work/libmpv-android-$LIBMPV_ANDROID_REVISION"
out="$work/$LIBMPV_ANDROID_REVISION-lgpl"

if [ ! -d "$src/.git" ]; then
  git clone --quiet "$LIBMPV_ANDROID_REPOSITORY" "$src"
fi
git -C "$src" fetch --quiet origin "$LIBMPV_ANDROID_REVISION" 2>/dev/null || true
git -C "$src" checkout --quiet --force "$LIBMPV_ANDROID_REVISION"

cd "$src/buildscripts"

# The NDK React Native builds with, so libmpv and the app share one libc++.
perl -pi -e "s/^v_ndk=.*/v_ndk=$LIBMPV_NDK/" include/depinfo.sh

# Meson installs under its default prefix inside each DESTDIR; Homebrew's meson defaults to
# /opt/homebrew, so the cross file names the prefix the flat staging layout expects.
if ! grep -q "^prefix = '/usr/local'" build.sh; then
  perl -pi -e "s/^default_library = 'static'\$/\$&\nprefix = '\/usr\/local'/" build.sh
fi

# The LGPL configuration.
perl -pi -e 's/--enable-\{gpl,version3\}/--enable-version3/' scripts/ffmpeg.sh
perl -pi -e 's/-Dlibmpv=true -Dcplayer=false/-Dlibmpv=true -Dcplayer=false -Dgpl=false/' scripts/mpv.sh
grep -q -- '--enable-gpl' scripts/ffmpeg.sh scripts/*.sh && { echo >&2 "A GPL switch remains"; exit 1; }

# The shared SDK, not a second copy: the scripts install their pinned platform and CMake into it.
# include/path.sh finds the NDK under android-sdk-linux on every host.
mkdir -p sdk
[ -e sdk/android-sdk-mac ] || ln -s "$ANDROID_HOME" sdk/android-sdk-mac
[ -e sdk/android-sdk-linux ] || ln -s "$ANDROID_HOME" sdk/android-sdk-linux

# Python modules the dependencies' generators import (Mbed TLS: jinja2, jsonschema), and Meson: fontconfig
# needs 1.11 or later, newer than Linux distributions ship.
if ! "$work/venv/bin/python3" -c 'import jinja2, jsonschema, mesonbuild' 2>/dev/null; then
  python3 -m venv "$work/venv"
  PIP_USER=0 "$work/venv/bin/pip" install --quiet --disable-pip-version-check jinja2 jsonschema 'meson>=1.11'
fi
export PATH="$work/venv/bin:$PATH"
IN_CI=1 ./include/download-sdk.sh
./include/download-deps.sh
./patch.sh

# FFmpeg's and mpv's build directories per arch (build.sh's ndk_suffix), and the Android ABI.
suffix_of() { case "$1" in arm64) echo -arm64 ;; x86_64) echo -x64 ;; esac; }
abi_of() { case "$1" in arm64) echo arm64-v8a ;; x86_64) echo x86_64 ;; esac; }

mkdir -p "$out"
for arch in "${archs[@]}"; do
  abi="$(abi_of "$arch")"
  if [ -z "$abi" ]; then
    echo >&2 "Unsupported arch $arch (arm64 or x86_64)"
    exit 1
  fi
  ./build.sh --arch "$arch" mpv

  # Refuse anything but an LGPL result.
  suffix="$(suffix_of "$arch")"
  grep -q 'FFMPEG_LICENSE "LGPL version 3 or later"' "deps/ffmpeg/_build$suffix/config.h"
  grep -q 'HAVE_GPL 0' "deps/mpv/_build$suffix/config.h"

  mkdir -p "$out/jniLibs/$abi"
  for library in libmpv libavcodec libavformat libavutil libavfilter libavdevice libswresample libswscale; do
    cp -L "prefix/$abi/lib/$library.so" "$out/jniLibs/$abi/"
  done
  if [ ! -d "$out/include/mpv" ]; then
    mkdir -p "$out/include"
    cp -R "prefix/$abi/include/mpv" "$out/include/"
  fi
done
echo "libmpv (LGPL) for ${archs[*]}: $out"
