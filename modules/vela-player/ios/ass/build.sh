#!/bin/sh
# Builds libass for Vela's Apple players: Libass.xcframework (libass with FreeType and HarfBuzz linked in
# statically, all permissive licences) and Fribidi.xcframework (LGPL-2.1, kept a separate dynamic framework
# so it stays replaceable). Fonts come from Core Text and the container's attachments; no fontconfig.
#
#   modules/vela-player/ios/ass/build.sh [--out <dir>] [--work <scratch dir>]
#
# The pinned sources are fetched over HTTPS and checked against the SHA-256 sums below. The result lands
# in modules/vela-player/ios/ass/build (gitignored), where VelaPlayer.podspec picks it up; without it the
# player draws ASS as plain text. Slices: tvOS, tvOS Simulator, iOS and iOS Simulator (arm64).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=$here/build
work=${TMPDIR:-/tmp}/vela-libass
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out=$2; shift ;;
    --work) work=$2; shift ;;
    *) echo "usage: $0 [--out <dir>] [--work <dir>]" >&2; exit 2 ;;
  esac
  shift
done
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
for tool in meson ninja pkg-config; do
  command -v $tool >/dev/null || { echo "libass build: $tool is required" >&2; exit 2; }
done

# name version url sha256
sources="
freetype 2.15.0 https://download.savannah.gnu.org/releases/freetype/freetype-2.15.0.tar.xz 93cd47eb719c325107f2d3cf087d06299e944c3b48a40b55537302304dea1dd5
fribidi 1.0.18 https://github.com/fribidi/fribidi/releases/download/v1.0.18/fribidi-1.0.18.tar.xz 1de5e8073d035388b71d0b2d452b1da1f8caeea8a7702997b401fe1b6250727f
harfbuzz 15.2.0 https://github.com/harfbuzz/harfbuzz/releases/download/15.2.0/harfbuzz-15.2.0.tar.xz e2ec49090744383cdbe7df808c1cedaafba06a97be8dc4211fe546ba585f12cb
libass 0.17.5 https://github.com/libass/libass/releases/download/0.17.5/libass-0.17.5.tar.xz 2dca25c0e0c837ddf00b52011b3f82cac1e4ddd3ad018227806b0c2288864acc
"
mkdir -p "$work/src" "$work/archives"
echo "$sources" | while read -r name version url sum; do
  [ -n "$name" ] || continue
  archive=$work/archives/$name-$version.tar.xz
  [ -f "$archive" ] || curl -fsSL "$url" -o "$archive"
  echo "$sum  $archive" | shasum -a 256 -c - >/dev/null || { echo "libass build: $archive does not match its pinned SHA-256" >&2; exit 1; }
  [ -d "$work/src/$name-$version" ] || tar -xf "$archive" -C "$work/src"
done

# slice sdk target
slices="
tvos appletvos arm64-apple-tvos18.0
tvos-sim appletvsimulator arm64-apple-tvos18.0-simulator
ios iphoneos arm64-apple-ios18.0
ios-sim iphonesimulator arm64-apple-ios18.0-simulator
"
build_slice() {
  slice=$1 sdk=$2 target=$3
  prefix=$work/prefix/$slice
  sysroot=$(xcrun --sdk "$sdk" --show-sdk-path)
  cross=$work/cross-$slice.ini
  cat >"$cross" <<EOF
[binaries]
c = ['$(xcrun --sdk "$sdk" -f clang)', '-target', '$target', '-isysroot', '$sysroot']
cpp = ['$(xcrun --sdk "$sdk" -f clang++)', '-target', '$target', '-isysroot', '$sysroot']
objc = ['$(xcrun --sdk "$sdk" -f clang)', '-target', '$target', '-isysroot', '$sysroot']
ar = '$(xcrun --sdk "$sdk" -f ar)'
strip = '$(xcrun --sdk "$sdk" -f strip)'
pkg-config = 'pkg-config'
[built-in options]
c_args = ['-O2']
cpp_args = ['-O2']
[properties]
pkg_config_libdir = '$prefix/lib/pkgconfig'
[host_machine]
system = 'darwin'
cpu_family = 'aarch64'
cpu = 'arm64'
endian = 'little'
EOF
  common="--cross-file $cross --prefix $prefix --libdir lib --buildtype release --wrap-mode nodownload"
  configure() { # name dir options...
    name=$1 dir=$2; shift 2
    rm -rf "$work/obj/$slice/$name"
    meson setup "$work/obj/$slice/$name" "$work/src/$dir" $common "$@" >"$work/obj-$slice-$name.log" 2>&1 \
      || { tail -30 "$work/obj-$slice-$name.log"; exit 1; }
    ninja -C "$work/obj/$slice/$name" install >>"$work/obj-$slice-$name.log" 2>&1 \
      || { tail -30 "$work/obj-$slice-$name.log"; exit 1; }
  }
  configure freetype freetype-2.15.0 --default-library static -Dzlib=disabled -Dbzip2=disabled -Dpng=disabled \
    -Dbrotli=disabled -Dharfbuzz=disabled -Dhvf=disabled -Dtests=disabled -Dmmap=enabled
  configure fribidi fribidi-1.0.18 --default-library shared -Ddocs=false -Dbin=false -Dtests=false -Ddeprecated=false
  configure harfbuzz harfbuzz-15.2.0 --default-library static -Dfreetype=enabled -Dglib=disabled -Dgobject=disabled \
    -Dcairo=disabled -Dchafa=disabled -Dicu=disabled -Dtests=disabled -Dintrospection=disabled -Ddocs=disabled \
    -Dutilities=disabled -Dsubset=disabled -Draster=disabled -Dvector=disabled -Dcoretext=disabled
  configure libass libass-0.17.5 --default-library static -Dfontconfig=disabled -Dcoretext=enabled \
    -Dlibunibreak=disabled -Dtest=disabled -Dcompare=disabled -Dprofile=disabled -Dfuzz=disabled -Dcheckasm=disabled \
    -Dasm=disabled -Drequire-system-font-provider=true

  frameworks=$work/frameworks/$slice
  rm -rf "$frameworks"; mkdir -p "$frameworks"
  # Fribidi: the LGPL library itself, a replaceable dynamic framework.
  fw=$frameworks/Fribidi.framework
  mkdir -p "$fw/Headers"
  cp "$(ls "$prefix"/lib/libfribidi.*.dylib | head -1)" "$fw/Fribidi"
  install_name_tool -id @rpath/Fribidi.framework/Fribidi "$fw/Fribidi"
  cp "$prefix"/include/fribidi/*.h "$fw/Headers/"
  plist "$fw" Fribidi app.ether.vela.fribidi 1.0.18 "$sdk"
  # Libass: libass, FreeType and HarfBuzz as one dynamic framework linking Fribidi.
  fw=$frameworks/Libass.framework
  mkdir -p "$fw/Headers" "$fw/Modules"
  "$(xcrun --sdk "$sdk" -f clang)" -target "$target" -isysroot "$sysroot" -dynamiclib -o "$fw/Libass" \
    -install_name @rpath/Libass.framework/Libass \
    -Wl,-all_load "$prefix/lib/libass.a" "$prefix/lib/libharfbuzz.a" "$prefix/lib/libfreetype.a" \
    -F"$frameworks" -framework Fribidi -framework CoreText -framework CoreFoundation -framework CoreGraphics -liconv -lc++ \
    -Wl,-exported_symbols_list,"$here/libass.exports"
  cp "$prefix"/include/ass/*.h "$fw/Headers/"
  printf 'framework module Libass {\n  umbrella header "ass.h"\n  export *\n}\n' >"$fw/Modules/module.modulemap"
  plist "$fw" Libass app.ether.vela.libass 0.17.5 "$sdk"
}

plist() { # framework name id version sdk
  case "$5" in
    appletvos) platform=AppleTVOS ;;
    appletvsimulator) platform=AppleTVSimulator ;;
    iphoneos) platform=iPhoneOS ;;
    *) platform=iPhoneSimulator ;;
  esac
  cat >"$1/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>$2</string>
<key>CFBundleIdentifier</key><string>$3</string>
<key>CFBundleName</key><string>$2</string>
<key>CFBundlePackageType</key><string>FMWK</string>
<key>CFBundleShortVersionString</key><string>$4</string>
<key>CFBundleVersion</key><string>$4</string>
<key>CFBundleSupportedPlatforms</key><array><string>$platform</string></array>
<key>MinimumOSVersion</key><string>18.0</string>
</dict></plist>
EOF
}

echo "$slices" | while read -r slice sdk target; do
  [ -n "$slice" ] || continue
  echo "libass build: $slice"
  build_slice "$slice" "$sdk" "$target"
done
rm -rf "$out"; mkdir -p "$out"
for name in Fribidi Libass; do
  args=""
  for slice in tvos tvos-sim ios ios-sim; do args="$args -framework $work/frameworks/$slice/$name.framework"; done
  xcodebuild -create-xcframework $args -output "$out/$name.xcframework" >/dev/null
done
# Licences travel with the frameworks (and are bundled into VelaPlayerLicenses by the podspec).
mkdir -p "$out/licenses"
cp "$work/src/libass-0.17.5/COPYING" "$out/licenses/libass.ISC.txt"
cp "$work/src/fribidi-1.0.18/COPYING" "$out/licenses/fribidi.LGPL-2.1.txt"
cp "$work/src/harfbuzz-15.2.0/COPYING" "$out/licenses/harfbuzz.MIT.txt"
cp "$work/src/freetype-2.15.0/docs/FTL.TXT" "$out/licenses/freetype.FTL.txt"
printf 'libass 0.17.5, FriBidi 1.0.18, HarfBuzz 15.2.0, FreeType 2.15.0: sources and checksums in modules/vela-player/ios/ass/build.sh.\n' >"$out/licenses/SOURCES.txt"
echo "libass build: $out"
