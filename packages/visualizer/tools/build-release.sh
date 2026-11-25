#!/bin/sh
# Regenerate shipped sources from the approved scene parts. glslang and spirv-cross
# are authoring tools. App builds use the checked-in results.
set -eu
cd "$(dirname "$0")/../../.."
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT
bun packages/visualizer/tools/build.ts --production --out "$build_dir"
bun packages/visualizer/tools/apple-shaders.ts "$build_dir"
bun packages/visualizer/tools/build-web.ts
cp "$build_dir"/viz-native.js "$build_dir"/apple-shaders.json modules/vela-player/ios/VisualizerAssets/
cp "$build_dir"/scenes.json packages/visualizer/
bun packages/visualizer/tools/picker-assets.ts
