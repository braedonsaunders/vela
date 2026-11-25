# Visualizer command protocol (native hosts)

The visualizer framework (`framework/*.js`) is written against WebGL2. Natively it runs unchanged in a JS engine
on the render thread (JavaScriptCore on Apple, Hermes on Android) against `glrec.js`, a WebGL2 facade that turns
each call into an explicit command. The executor (Metal or GLES) replays the commands. `replay-webgl.js` is the
reference executor; the GLES executor is the same calls in C++.

## Host object

Installed as the global `__host` before `viz-native.js` (from `tools/build.ts`) is evaluated.

| member | |
| --- | --- |
| `commandBuffer: ArrayBuffer` | shared with the executor (16 MB: a frame is 2–4k words, but scene set-up uploads whole meshes — the 384² grid index buffer alone is 3.5 MB) |
| `flush(words)` | execute words `[1, words)` of `commandBuffer` now, synchronously. Called at the end of each frame and before every `link` |
| `link(id, vs, fs)` | `{ ok, log, uniforms: [{ name, type, size }] }` for the program's active uniforms (GL type enums, array size, names without `[0]`). The index in `uniforms` is the location id used by `UNIFORM`. GLES: compile now. Metal: look the pair up in the build-time table |
| `bandDb: Float32Array(256)`, `wave: Float32Array(512)` | the reduced spectrum and aligned waveform for this frame (see DSP below), written before `__viz.frame` |
| `now()` | milliseconds, monotonic |
| `width`, `height`, `dpr`, `sampleRate`, `scene?` | initial values; later changes go through `__viz.resize(w, h, dpr)` and `__viz.audioFormat(rate)` |
| `log(s)` | |
| `canvasImage(c)` | Reserved for opaque host images. The map label atlas uses the standard byte upload. |

The script defines `__viz`: `frame(nowMs)`, `setScene(i | id)`, `setPalette(i)`, `resize(w, h, dpr)`,
`audioFormat(rate)`, `scenes`, `stats()`.

## Buffer layout

`Int32` words, with `Float32` and byte views on the same memory. Word 0 is the word count. Commands follow:
an opcode, then its arguments. A **bytes** argument is a byte length followed by the bytes, padded to whole words.
Floats are written as float32 bits in the word (read with the float view).

## Opcodes

Ids are small positive integers minted by the facade; 0 means "none" (or the screen for framebuffers).

| op | name | args |
| --- | --- | --- |
| 1 | TEX_CREATE | tex |
| 2 | TEX_DELETE | tex |
| 3 | TEX_IMAGE | tex, internalFormat, w, h, format, type, flipY, bytes (byte length 0 = allocate only) |
| 4 | TEX_SUB | tex, x, y, w, h, format, type, bytes |
| 5 | TEX_PARAM | tex, pname, value (MIN/MAG filter, WRAP_S/T) |
| 6 | TEX_MIPMAP | tex |
| 7 | FB_CREATE | fb |
| 8 | FB_DELETE | fb |
| 9 | FB_ATTACH_TEX | fb, attachment (COLOR_ATTACHMENT0), tex |
| 10 | FB_ATTACH_RB | fb, attachment (COLOR_ATTACHMENT0 or DEPTH_ATTACHMENT), rb |
| 11 | RB_CREATE | rb |
| 12 | RB_DELETE | rb |
| 13 | RB_STORAGE | rb, samples (0 = single), internalFormat, w, h |
| 14 | BUF_CREATE | buf |
| 15 | BUF_DATA | buf, isElements (0/1), bytes |
| 16 | VAO_CREATE | vao |
| 17 | VAO_ATTRIB | vao, location, buf, size, type, normalized, stride, offset, divisor, enabled |
| 18 | VAO_ELEMENTS | vao, buf |
| 19 | USE_PROGRAM | program |
| 20 | UNIFORM | program, location id, kind, count, then count × components words |
| 21 | BIND_FB | fb (0 = screen) |
| 22 | VIEWPORT | x, y, w, h |
| 23 | CLEAR | mask (COLOR 0x4000 \| DEPTH 0x100), r, g, b, a (float), depth (float) — clears the bound framebuffer, ignoring colour/depth masks |
| 24 | STATE | flags, blendSrc, blendDst, depthFunc, cullFace, colorMask (bits r1 g2 b4 a8) |
| 25 | BIND_TEX | unit, tex |
| 26 | DRAW | mode, first, count, instances, vao (0 = no attributes) |
| 27 | DRAW_ELEMENTS | mode, count, type (UNSIGNED_INT), byteOffset, instances, vao |
| 28 | BLIT | readFb, drawFb, sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter (used only to resolve the MSAA buffer, same size) |
| 29 | PROGRAM_DELETE | program |
| 30 | FRAME_END | — present |
| 31 | TEX_IMAGE_HOST | tex, internalFormat, w, h, imageId, flipY, 0 |

UNIFORM kinds: 1 float, 2 vec2, 3 vec3, 4 vec4, 5 int (sampler units), 6 mat3, 7 mat4 (column-major). `count`
is the array length (e.g. `uPulse[8]`: kind 1, count 8). A uniform keeps its value per program until set again,
as in GL.

STATE flags: 1 blend, 2 depth test, 4 cull face, 8 alpha-to-coverage, 16 depth write. With depth test off nothing
is written to depth (GL semantics).

Before each draw the facade sends `BIND_FB`/`VIEWPORT`/`STATE` if they changed and `BIND_TEX` for any of units
0–15 whose texture changed. A sampler uniform names its unit with an int UNIFORM.

## Formats used

`RGBA8`/`UNSIGNED_BYTE`, `RGBA16F`/`HALF_FLOAT` or `FLOAT` data, `RGBA32F`/`FLOAT`, `R16F`/`FLOAT` data,
`RG8`/`UNSIGNED_BYTE`, `R8`/`UNSIGNED_BYTE`; renderbuffers `RGBA16F` and `DEPTH_COMPONENT24` with 4 samples.
GLES 3.0 needs `EXT_color_buffer_float` (or `_half_float`) to render to float targets; RGBA32F is only ever sampled
with NEAREST, so `OES_texture_float_linear` is not required. Metal converts `FLOAT` uploads into half-float textures.

## Map labels

The native bundle includes the fixed Contour label atlas only when it includes that scene. Its R8 bytes are in GL bottom-row-first order. TEX_IMAGE uploads level zero without flipping, TEX_MIPMAP generates the lower levels, and the sampler uses clamped coordinates with linear magnification and trilinear minification. The scene samples the red channel. See the [asset manifest and regeneration procedure](../assets/README.md).

## Coordinates (Metal)

Everything keeps GL's memory layout: row 0 of every texture and render target is GL's bottom row. Vertex shaders
are cross-compiled with a flipped clip-space Y, which puts GL's y = −1 on Metal's row 0, so render targets,
uploads, `texture()` and `gl_FragCoord` all agree with GL. Only the screen is the other way up: draws to fb 0 use
the vertex shader compiled without the flip. Triangle winding flips with Y, so a Metal executor inverts the
front-face winding on flipped passes.

## DSP (native, next to the PCM tap)

Per frame, from the mono mix of what is being *heard* now (the tap runs ahead of the speaker: about 370 ms on
Apple, the AudioTrack latency on Android, so index the ring buffer by heard time):

1. AnalyserNode-equivalent (Web Audio spec), fftSize 4096: Blackman window (α = 0.16) over the last 4096 samples,
   real FFT, magnitude `|X[k]| / 4096`, temporal smoothing `S[k] = 0.55·S[k] + 0.45·|X[k]|`, `dB[k] = 20·log10(S[k])`
   for k in 0..2047 (−∞ for zero).
2. `vizReduce` in `analyse-split.js`: the maximum dB over each of the 256 log bands (`binOf` from the sample rate),
   and the waveform: first upward zero crossing in samples 64–1000, then 512 points of 3-sample means every 6 samples.

`bandDb` and `wave` go to the host object; `analyse-split.js`'s `vizInterpret` does the rest in JS.
