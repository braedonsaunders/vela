#!/usr/bin/env bash
# Averages the STAT reporting windows of a run (logcat tag VizSpike), skipping the first 10 windows (warm-up:
# the other scenes' programs are compiled then), and reports the underruns over the whole run.
set -euo pipefail
awk '
  /audio underrun #/ { underrunLines++ }
  /STAT scene=/ {
    n++; if (n <= 10) next
    for (i = 1; i <= NF; i++) { split($i, kv, "="); v[kv[1]] = kv[2] }
    interval += v["interval"]; m++; fps += v["fps"]; js += v["js"]; jo += v["jsOnly"]; ex += v["exec"]; dsp += v["dsp"]; jank += v["jank"]
    if (v["max"] + 0 > mx) mx = v["max"] + 0
    if (match($0, /gpu=[0-9.]+\(timer/)) { g = substr($0, RSTART + 4); gt += g + 0; gn++ }
    if (match($0, /gpu=finish:[0-9.]+/)) { g = substr($0, RSTART + 11); gf += g + 0; gn2++ }
    if (match($0, /wall:[0-9.]+/)) { g = substr($0, RSTART + 5); gw += g + 0 }
    split(v["underruns"], u, "("); under = u[1] + 0; res = v["res"]; scene = v["scene"]; lead = v["lead"]; bud = v["budget"]
  }
  END {
    if (!m) { print "no STAT lines after warm-up"; exit 1 }
    printf "%s: %d reporting windows (after 10 warm-up windows)  fps %.1f  mean interval %.1f ms  js %.2f ms (js-only %.2f, executor %.2f)  dsp %.3f ms  jank %d  max interval %.1f ms\n", scene, m, fps/m, interval/m, js/m, jo/m, ex/m, dsp/m, jank, mx
    if (gn) printf "  gpu (timer query) %.2f ms\n", gt/gn
    if (gn2) printf "  gpu (glFinish wait) %.2f ms, js+exec+finish %.2f ms\n", gf/gn2, gw/gn2
    printf "  res %s budget %s  audio lead (tap ahead of heard) %s  underruns over the whole run: %d\n", res, bud, lead, under
    printf "  underrun log lines: %d\n", underrunLines
  }' "$1"
