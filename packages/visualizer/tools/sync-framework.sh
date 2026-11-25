#!/bin/sh
# Copies the visualizer framework parts from the design workspace (round 4: ~/.scratch/tmp/viz-unified/src).
# Afterwards run `bun test packages/visualizer`: the analysis-split test fails if 10_audio.js changed underneath it.
src=${1:-$HOME/.scratch/tmp/viz-unified/src}
cd "$(dirname "$0")/../framework" && cp "$src"/*.js "$src"/00_head.html . && ls | wc -l
