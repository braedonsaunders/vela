'use strict';
// Runs before the framework on a native host (JavaScriptCore on Apple, Hermes on Android) and in headless tools.
// It stands in for the few browser globals the framework touches, so the framework itself is loaded unchanged.
// The host object `__host` is installed by the native side before this script runs:
//   link(id, vs, fs), flush(words), canvasImage(c), now(), log(s)
//   commandBuffer: ArrayBuffer                (shared with the executor)
//   freq: Float32Array(2048), time: Float32Array(4096)   (AnalyserNode-equivalent output, written before each frame)
//   width, height, dpr, sampleRate
var console = typeof console !== 'undefined' ? console : { log: s => __host.log(String(s)), warn: s => __host.log('warn: ' + s), error: s => __host.log('error: ' + s) };
var window = globalThis;
var location = { search: '?mute' };
var innerWidth = __host.width, innerHeight = __host.height, devicePixelRatio = __host.dpr;
var performance = { now: () => __host.now() };
if (typeof URLSearchParams === 'undefined') {
  globalThis.URLSearchParams = function (q) { const m = new Map(); String(q).replace(/^\?/, '').split('&').filter(Boolean).forEach(kv => { const i = kv.indexOf('='); m.set(decodeURIComponent(i < 0 ? kv : kv.slice(0, i)), i < 0 ? '' : decodeURIComponent(kv.slice(i + 1))); });
    return { has: k => m.has(k), get: k => m.has(k) ? m.get(k) : null }; };
}
// Timers run at the start of each frame; nothing in the framework needs better than frame accuracy.
var __timers = [], __timerId = 1, __raf = null;
var setTimeout = (fn, ms) => { const id = __timerId++; __timers.push({ id, at: __host.now() + (ms || 0), fn }); return id; };
var clearTimeout = id => { __timers = __timers.filter(t => t.id !== id); };
var requestAnimationFrame = fn => { __raf = fn; return 1; };
var addEventListener = () => {};
// A host may hand over a real WebGL2 context instead (tools: the direct half of the record/replay comparison).
var __gl = __host.directGL ? Object.assign(__host.directGL, { __endFrame() {}, __stats() { return {}; } }) : createRecordingGL(__host, {});
var __canvas = { width: 0, height: 0, getContext: () => __gl, style: {} };
if (!__host.directGL) __gl.canvas = __canvas;
var document = { hidden: false, getElementById: id => id === 'c' ? __canvas : null,
  createElement: () => { throw new Error('document.createElement is not available on a native host'); } };
