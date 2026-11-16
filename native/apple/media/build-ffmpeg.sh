#!/bin/sh
# Build VelaMedia.xcframework: FFmpeg's demuxers, the audio decoders Apple TV lacks and the
# subtitle decoders, plus Vela's C shim (vela_media.c), as ONE dynamic framework the tvOS
# native module links. LGPL-2.1-or-later only: no --enable-gpl, no --enable-nonfree, no
# external libraries but the SDK's zlib. Video is never decoded here (VideoToolbox does it).
#
#   native/apple/media/build-ffmpeg.sh <out-dir>
#
# Sources are pinned by hash and kept beside the framework (sources/), with the licence,
# so the corresponding source of the distributed binary is always at hand. The framework is
# a separately linked, replaceable library (@rpath/VelaMedia.framework/VelaMedia).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:?usage: build-ffmpeg.sh <out-dir>}
mkdir -p "$out"; out=$(cd "$out" && pwd)
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
version=7.1.2
sha=089bc60fb59d6aecc5d994ff530fd0dcb3ee39aa55867849a2bbc4e555f9c304
work=${VELA_FFMPEG_WORK:-$HOME/.scratch/vela-build/tvos/ffmpeg}
mkdir -p "$work/src"
tarball="$work/src/ffmpeg-$version.tar.xz"
[ -f "$tarball" ] || curl -sSfL -o "$tarball" "https://ffmpeg.org/releases/ffmpeg-$version.tar.xz"
echo "$sha  $tarball" | shasum -a 256 -c - >/dev/null
min=17.0

demuxers=matroska,mov,mpegts
parsers=h264,hevc,aac,aac_latm,ac3,dca,mlp,mpegaudio,flac,opus,vorbis,dvdsub,dvbsub
audio=aac,ac3,eac3,dca,truehd,mlp,flac,alac,opus,vorbis,mp3,mp2,pcm_s16le,pcm_s24le,pcm_s32le,pcm_s16be,pcm_s24be,pcm_f32le,pcm_bluray,pcm_dvd
subtitles=pgssub,dvdsub,dvbsub,subrip,srt,ass,ssa,movtext,webvtt,text

build_slice() { # <sdk> <triple-suffix> <dir>
  sdk=$1; flag=$2; dir=$3
  sysroot=$(xcrun --sdk "$sdk" --show-sdk-path)
  cc="$(xcrun --sdk "$sdk" --find clang)"
  cflags="-arch arm64 $flag -isysroot $sysroot -O2 -fno-common"
  if [ ! -f "$dir/lib/ffmpeg.done" ]; then
  rm -rf "$dir/build"; mkdir -p "$dir/build"
  tar -xf "$tarball" -C "$dir/build"
  ( cd "$dir/build/ffmpeg-$version" && ./configure --prefix="$dir" \
      --enable-cross-compile --target-os=darwin --arch=aarch64 --cc="$cc" --sysroot="$sysroot" \
      --extra-cflags="$cflags" --extra-ldflags="$cflags" \
      --disable-everything --disable-autodetect --disable-programs --disable-doc --disable-network \
      --disable-avdevice --disable-avfilter --disable-swscale --disable-postproc \
      --enable-static --disable-shared --enable-pic --enable-zlib \
      --enable-demuxer=$demuxers --enable-parser=$parsers --enable-decoder=$audio,$subtitles \
      --enable-protocol=file >"$dir/configure.log" 2>&1 \
    || { tail -30 "$dir/configure.log"; exit 1; }
    grep -q 'License: LGPL version 2.1 or later' "$dir/configure.log" || { echo "ffmpeg: configuration is not LGPL-only"; exit 1; }
    make -j6 >"$dir/make.log" 2>&1 || { tail -40 "$dir/make.log"; exit 1; }
    make install >>"$dir/make.log" 2>&1 )
  touch "$dir/lib/ffmpeg.done"
  fi
  # The shim and every FFmpeg library in one dynamic library.
  "$cc" $cflags -I"$dir/include" -c "$here/vela_media.c" -o "$dir/vela_media.o"
  mkdir -p "$dir/VelaMedia.framework/Headers" "$dir/VelaMedia.framework/Modules"
  "$cc" $cflags -dynamiclib -install_name @rpath/VelaMedia.framework/VelaMedia \
    -o "$dir/VelaMedia.framework/VelaMedia" "$dir/vela_media.o" \
    -Wl,-all_load "$dir/lib/libavformat.a" "$dir/lib/libavcodec.a" "$dir/lib/libswresample.a" "$dir/lib/libavutil.a" \
    -lz -lm -Wl,-dead_strip
  cp "$here/vela_media.h" "$dir/VelaMedia.framework/Headers/"
  printf 'framework module VelaMedia {\n  umbrella header "vela_media.h"\n  export *\n}\n' >"$dir/VelaMedia.framework/Modules/module.modulemap"
  plat=$( [ "$sdk" = appletvos ] && echo AppleTVOS || echo AppleTVSimulator )
  cat >"$dir/VelaMedia.framework/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>VelaMedia</string>
<key>CFBundleIdentifier</key><string>app.ether.vela.media</string>
<key>CFBundleName</key><string>VelaMedia</string>
<key>CFBundlePackageType</key><string>FMWK</string>
<key>CFBundleShortVersionString</key><string>$version</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleSupportedPlatforms</key><array><string>$plat</string></array>
<key>MinimumOSVersion</key><string>$min</string>
</dict></plist>
EOF
}

build_slice appletvos "-mtvos-version-min=$min" "$work/appletvos"
[ "${VELA_MEDIA_SIMULATOR:-0}" = 1 ] && build_slice appletvsimulator "-mtvos-simulator-version-min=$min" "$work/appletvsimulator"

rm -rf "$out/VelaMedia.xcframework"
set -- -framework "$work/appletvos/VelaMedia.framework"
[ "${VELA_MEDIA_SIMULATOR:-0}" = 1 ] && set -- "$@" -framework "$work/appletvsimulator/VelaMedia.framework"
xcodebuild -create-xcframework "$@" -output "$out/VelaMedia.xcframework" >/dev/null
# Corresponding source and licence travel with the binary.
mkdir -p "$out/VelaMedia-sources"
cp "$tarball" "$here/vela_media.c" "$here/vela_media.h" "$here/build-ffmpeg.sh" "$out/VelaMedia-sources/"
tar -xOf "$tarball" "ffmpeg-$version/COPYING.LGPLv2.1" >"$out/VelaMedia-sources/COPYING.LGPLv2.1"
echo "VelaMedia: FFmpeg $version (LGPL-2.1-or-later) at $out/VelaMedia.xcframework"
