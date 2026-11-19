#!/bin/sh
# Requires the platform's development packages for libass, libplacebo, EGL,
# PulseAudio/ALSA, VA-API and VDPAU. Optional ffnvcodec enables NVDEC.
# Set both paths under ~/.scratch/tmp/<thread>/ on the build host.
set -eu
: "${VELA_NATIVE_BUILD_DIR:?Set a scratch build directory}"
: "${VELA_LGPL_PREFIX:?Set an empty installation prefix}"
mkdir -p "$VELA_NATIVE_BUILD_DIR" "$VELA_LGPL_PREFIX/notices"
cd "$VELA_NATIVE_BUILD_DIR"
curl -fL https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz -o ffmpeg.tar.xz
curl -fL https://github.com/mpv-player/mpv/archive/refs/tags/v0.41.0.tar.gz -o mpv.tar.gz
printf '%s\n' '05ee0b03119b45c0bdb4df654b96802e909e0a752f72e4fe3794f487229e5a41  ffmpeg.tar.xz' 'ee21092a5ee427353392360929dc64645c54479aefdb5babc5cfbb5fad626209  mpv.tar.gz' | sha256sum -c -
tar -xf ffmpeg.tar.xz
tar -xf mpv.tar.gz
cd ffmpeg-8.0.1
nvdec='--disable-nvdec'
if pkg-config --exists ffnvcodec; then nvdec='--enable-ffnvcodec --enable-nvdec'; fi
# Disable external codec autodetection: system x264/x265 and other GPL libraries
# must never silently enter this build. FFmpeg's internal decoders remain enabled.
./configure --prefix="$VELA_LGPL_PREFIX" --enable-shared --disable-static \
  --disable-gpl --disable-nonfree --disable-autodetect --disable-doc \
  --disable-debug --disable-programs --disable-avdevice --disable-x86asm \
  --enable-network --enable-openssl --enable-vaapi --enable-vdpau $nvdec
make -j"${VELA_BUILD_JOBS:-4}"
make install
cp COPYING.LGPLv2.1 "$VELA_LGPL_PREFIX/notices/FFmpeg-LGPL.txt"
cp ffbuild/config.mak "$VELA_LGPL_PREFIX/notices/ffmpeg-config.mak"
cd ../mpv-0.41.0
export PKG_CONFIG_PATH="$VELA_LGPL_PREFIX/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
meson setup build --prefix="$VELA_LGPL_PREFIX" --libdir=lib \
  -Dgpl=false -Dlibmpv=true -Dcplayer=false -Dlua=disabled \
  -Djavascript=disabled -Dlibarchive=disabled -Ddvdnav=disabled \
  -Dcdda=disabled -Drubberband=disabled -Dlibavdevice=disabled -Dlibbluray=disabled
ninja -C build -j"${VELA_BUILD_JOBS:-4}"
meson install -C build
cp Copyright LICENSE.LGPL "$VELA_LGPL_PREFIX/notices/"
cp build/meson-info/intro-buildoptions.json "$VELA_LGPL_PREFIX/notices/mpv-build-options.json"
cd ..
cp ffmpeg.tar.xz mpv.tar.gz "$VELA_LGPL_PREFIX/notices/"
printf '%s\n' 'Stage audited libass/libplacebo dependencies and their notices, then write provenance.json as described in README.md before running linux/build.mjs.'
