#!/usr/bin/env bash
# Build only Media3's FFmpeg audio extension, never mpv or GPL/nonfree codecs.
# Output and upstream source remain under ~/.scratch; run on the Android build host.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$root"
source tools/android-env.sh
version=1.11.1
work="$HOME/.scratch/vela-build/media3/$version"
if [ ! -d "$work/.git" ]; then
  git clone --depth 1 --branch "$version" https://github.com/androidx/media.git "$work"
fi
[ "$(git -C "$work" rev-parse HEAD)" = 8c6678b657ede1e7883fc164ef73ed483c7796c3 ] || { echo 'Unexpected Media3 revision' >&2; exit 1; }
jni="$work/libraries/decoder_ffmpeg/src/main/jni"
if [ ! -d "$jni/ffmpeg/.git" ]; then
  git clone --depth 1 --branch n6.0.1 https://github.com/FFmpeg/FFmpeg.git "$jni/ffmpeg"
fi
[ "$(git -C "$jni/ffmpeg" rev-parse HEAD)" = c41ff724ede7da657762d61097e26fac296c53bf ] || { echo 'Unexpected FFmpeg revision' >&2; exit 1; }
ndk="$ANDROID_HOME/ndk/27.1.12297006"
case $(uname -s) in Darwin) host=darwin-x86_64 ;; *) host=linux-x86_64 ;; esac
toolchain="$ndk/toolchains/llvm/prebuilt/$host/bin"
cd "$jni/ffmpeg"
for abi in arm64-v8a x86_64; do
  case $abi in arm64-v8a) arch=aarch64; triple=aarch64-linux-android ;; x86_64) arch=x86_64; triple=x86_64-linux-android ;; esac
  [ -f "android-libs/$abi/include/libavutil/avconfig.h" ] && continue
  ./configure --target-os=android --arch="$arch" --enable-cross-compile \
    --cc="$toolchain/${triple}26-clang" --cxx="$toolchain/${triple}26-clang++" \
    --ar="$toolchain/llvm-ar" --nm="$toolchain/llvm-nm" --ranlib="$toolchain/llvm-ranlib" \
    --strip="$toolchain/llvm-strip" --enable-pic --enable-static --disable-shared \
    --disable-gpl --disable-nonfree --disable-version3 --disable-doc --disable-programs \
    --disable-everything --disable-avdevice --disable-avformat --disable-swscale \
    --disable-postproc --disable-avfilter --disable-symver --disable-x86asm \
    --enable-swresample --enable-decoder=aac,ac3,eac3,dca,truehd,mlp,flac,alac,opus,vorbis,mp3,mp2,pcm_s16le,pcm_s24le,pcm_s32le,pcm_bluray,pcm_dvd \
    --libdir="android-libs/$abi" --incdir="android-libs/$abi/include"
  if [ ! -f "android-libs/$abi/libavcodec.a" ]; then
    make -j4
    make install-libs
  fi
  make install-headers
  cp config.h "android-libs/$abi/vela-config.h"
  make distclean
 done
# The JNI wrapper includes FFmpeg's public headers; no configured header is required.
