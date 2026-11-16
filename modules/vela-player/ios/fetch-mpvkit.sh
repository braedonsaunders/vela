#!/bin/sh
# Fetches MPVKit 1.0.0's LGPL xcframeworks (mpvkit-1.0.0.txt), verified by their pinned SHA-256,
# into the scratch drive, and links each here, in Frameworks/, for the podspec to vendor.
#   modules/vela-player/ios/fetch-mpvkit.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cache=${VELA_MPVKIT_CACHE:-$HOME/.scratch/vela-build/mpvkit/1.0.0}
mkdir -p "$cache"
grep -v '^#' "$here/mpvkit-1.0.0.txt" | while read -r name url sha; do
  [ -n "$name" ] || continue
  if [ ! -d "$cache/$name.xcframework" ]; then
    zip="$cache/$name.xcframework.zip"
    curl -sSfL -o "$zip" "$url"
    echo "$sha  $zip" | shasum -a 256 -c - >/dev/null || { echo "fetch-mpvkit: $name does not match its pinned hash" >&2; rm -f "$zip"; exit 1; }
    unzip -q -o "$zip" -d "$cache"
    rm -f "$zip"
  fi
done
# A real directory of links: CocoaPods lists a pod's files without descending into a linked directory.
rm -rf "$here/Frameworks"
mkdir -p "$here/Frameworks"
for framework in "$cache"/*.xcframework; do
  ln -s "$framework" "$here/Frameworks/$(basename "$framework")"
done
echo "fetch-mpvkit: $(ls -d "$cache"/*.xcframework | wc -l | tr -d ' ') xcframeworks in $cache"
