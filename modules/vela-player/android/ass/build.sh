#!/usr/bin/env bash
# Build libass (ISC) with FreeType (FTL), FriBidi (LGPL-2.1) and HarfBuzz (MIT) as static libraries for each
# Android ABI, from pinned source, for libvela_ass.so (ASS/SSA subtitles with full styling). No fontconfig:
# Vela gives libass its fonts. Needs meson, ninja and pkg-config; output under ~/.scratch. Run on the
# Android build host before Gradle. The pinned source and this script permit relinking FriBidi (LGPL).
set -euo pipefail
ANDROID_HOME="${ANDROID_HOME:-$HOME/.scratch/android-sdk}"
work="$HOME/.scratch/vela-build/ass/1"
ndk="$ANDROID_HOME/ndk/27.1.12297006"
case $(uname -s) in Darwin) host=darwin-x86_64 ;; *) host=linux-x86_64 ;; esac
bin="$ndk/toolchains/llvm/prebuilt/$host/bin"
mkdir -p "$work/src"
fetch() { # name repository tag commit
  if [ ! -d "$work/src/$1/.git" ]; then git clone -q --depth 1 --branch "$3" "$2" "$work/src/$1"; fi
  [ "$(git -C "$work/src/$1" rev-parse HEAD)" = "$4" ] || { echo "Unexpected $1 revision" >&2; exit 1; }
}
fetch freetype https://github.com/freetype/freetype.git VER-2-15-0 37515cf56ba3349656049edbed89ffc6f6466f2d
fetch fribidi https://github.com/fribidi/fribidi.git v1.0.18 15393e4937aa95bcf865d92143735746aeb654fa
fetch harfbuzz https://github.com/harfbuzz/harfbuzz.git 15.2.0 ed51d202cfd0c29372d3ee056eb0dc715688a410
fetch libass https://github.com/libass/libass.git 0.17.5 4a05d8127f525943ebf45fdc6497c9e665947f0d
for abi in armeabi-v7a arm64-v8a x86_64; do
  case $abi in
    armeabi-v7a) triple=armv7a-linux-androideabi; family=arm; cpu=armv7 ;;
    arm64-v8a) triple=aarch64-linux-android; family=aarch64; cpu=aarch64 ;;
    x86_64) triple=x86_64-linux-android; family=x86_64; cpu=x86_64 ;;
  esac
  prefix="$work/$abi"
  [ -f "$prefix/lib/libass.a" ] && continue
  cross="$work/cross-$abi.txt"
  cat > "$cross" <<CROSS
[binaries]
c = '$bin/${triple}26-clang'
cpp = '$bin/${triple}26-clang++'
ar = '$bin/llvm-ar'
strip = '$bin/llvm-strip'
pkg-config = 'pkg-config'
[host_machine]
system = 'android'
cpu_family = '$family'
cpu = '$cpu'
endian = 'little'
[built-in options]
c_args = ['-fPIC', '-ffunction-sections', '-fdata-sections']
cpp_args = ['-fPIC', '-ffunction-sections', '-fdata-sections']
[properties]
pkg_config_libdir = '$prefix/lib/pkgconfig'
CROSS
  build() { # name options...
    local name=$1; shift
    meson setup --reconfigure "$work/build/$abi/$name" "$work/src/$name" --cross-file "$cross" --prefix "$prefix" \
      --libdir lib --buildtype release -Ddefault_library=static "$@" >/dev/null
    ninja -C "$work/build/$abi/$name" install >/dev/null
  }
  build freetype -Dzlib=disabled -Dpng=disabled -Dbzip2=disabled -Dbrotli=disabled -Dharfbuzz=disabled
  build fribidi -Ddocs=false -Dbin=false -Dtests=false
  build harfbuzz -Dfreetype=disabled -Dglib=disabled -Dgobject=disabled -Dcairo=disabled -Dicu=disabled \
    -Dtests=disabled -Ddocs=disabled -Dutilities=disabled -Dintrospection=disabled
  build libass -Dfontconfig=disabled -Ddirectwrite=disabled -Dcoretext=disabled -Drequire-system-font-provider=false \
    -Dasm=disabled -Dlibunibreak=disabled -Dtest=disabled -Dcompare=disabled -Dprofile=disabled -Dfuzz=disabled -Dcheckasm=disabled
done
echo "libass archives in $work/<abi>/lib"
