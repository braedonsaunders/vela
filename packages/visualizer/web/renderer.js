// Generated from packages/visualizer/scenes by tools/build-web.ts.
import { frameBudget } from './frame-budget';
export function createRenderer(canvas, gl, stage) {
let innerWidth = stage.width, innerHeight = stage.height;
const renderModes = () => {};
// 10_audio.js
// ═════════════════════════ 1 · Audio analysis ═════════════════════════
// One analysis layer for every scene. What it publishes, and which envelope to use for what:
//
//   bands / bass, mid, high, level      fast (≈25 ms up, ≈110 ms down)      LIGHT only: glow, emissive, sparkle
//   bandsS / bassS, midS, highS, levelS slow (≈90 ms up, ≈400 ms down)      GEOMETRY: size, displacement, camera, speed
//   kick                                eased impulse: zero slope at the hit, top at ≈60 ms, gone by ≈550 ms.
//                                       Safe for geometry and for light that covers a lot of the screen.
//   kickL                               quicker twin (top at ≈35 ms, ≈200 ms tail) for small glints only
//   snare                               the same eased shape, fired by broadband mid/high onsets
//   pulse[8]                            the age in seconds of the last eight pulses, so a ring or wave can grow from
//                                       its own beat and fade at both ends; nothing ever has to wrap or restart.
//                                       A pulse needs 0.4 s since the last one, so a slot is at least 3.2 s old when it
//                                       is reused: longer than any ring lives, and no ring is ever cut short
//   dyn                                 0..1, how full the music is now against its own recent peak (≈1 s smoothing):
//                                       the section-level dynamics. Use it to scale whole forms and moods.
//   drop                                eased impulse (≈0.2 s up, ≈1.5 s down) when the energy jumps after a lull:
//                                       the chorus arriving. Use it for the big, rare gestures.
//   accent                              eased impulse (≈0.3 s up, ≈1.5 s down) on the strong beats: a kick clearly harder
//                                       than the recent ones, at most every 1.7 s and at least every 3.5 s. For slow, phrased gestures.
//   notes / hats (counters)             onsets in the mids (a note starting: noteBand says where, 0..1, noteAmp how hard)
//                                       and in the top octave (hatAmp). Scenes watch the counters to place their own events.
//   slow history texture (512×1)        dyn, accent, slow bass and slow level over the last ≈17 s, for waves that should
//                                       cross a scene at walking pace (gusts over a field)
//   spectrum texture (256×1, RG)        R = fast bands, G = slow bands
//   waterfall texture (128×256, R16F)   the spectrum's last ≈4 s as a ring buffer, read with a fractional head
//   waveform texture (512×1)            trigger-aligned and averaged over ≈70 ms, so the trace stands still and
//                                       anything it displaces moves like geometry, not like noise
//
// Porting note: everything here is plain arithmetic on an FFT magnitude array. On native platforms feed the
// same code from the player's tap (vDSP / Oboe FFT); nothing below depends on Web Audio except audioInit().

const BANDS = 256, WAVE = 512, HIST_W = 128, HIST_H = 256, HIST_HZ = 60;
const A = {
  ctx: null, analyser: null, bus: null, out: null, synth: null, mediaSrc: null, micSrc: null, source: 'none',
  freq: null, time: null, binOf: null, bandHz: new Float32Array(BANDS),
  bands: new Float32Array(BANDS), bandsS: new Float32Array(BANDS), bandsM: new Float32Array(BANDS), prevV: new Float32Array(BANDS),
  specU8: new Uint8Array(BANDS * 2), wave: new Float32Array(WAVE), waveU8: new Uint8Array(WAVE), histRow: new Float32Array(HIST_W),
  bass: 0, mid: 0, high: 0, level: 0, bassS: 0, midS: 0, highS: 0, levelS: 0,
  kickF: 0, kickR: 0, kickA: 0, kick: 0, kickL: 0, snareF: 0, snareR: 0, snareA: 0, snare: 0,
  dyn: 0, drop: 0, dropR: 0, dropA: 0, eLong: 0, ePeak: 0.15, sinceDrop: 9,
  accent: 0, accentR: 0, accentA: 0, accents: 0, kickAmp: 1, kMean: 1, sinceAccent: 9,
  notes: 0, noteBand: 0.5, noteAmp: 0, nAvg: 0, sinceNote: 9, hats: 0, hatAmp: 0, hAvg: 0, sinceHat: 9, bassVS: 0, levelVS: 0,
  slowRow: new Float32Array(4), slowAcc: 0,
  beat: 0, snares: 0, pulse: new Float32Array(8).fill(9), pulseAt: 0, sincePulse: 9, fluxAvg: 0, prevLow: 0, sfluxAvg: 0, agc: 1, agcPeak: 0.9,
};
for (let i = 0; i < BANDS; i++) A.bandHz[i] = 28 * Math.pow(16000 / 28, i / BANDS);   // log-spaced, 28 Hz – 16 kHz

// One-pole follower with separate attack and release rates (per second).
const env = (cur, target, dt, att, rel) => cur + (target - cur) * (1 - Math.exp(-dt * (target > cur ? att : rel)));

function analyse(dt) {
  for (let i = 0; i < 8; i++) A.pulse[i] = Math.min(99, A.pulse[i] + dt);
  A.sincePulse += dt;
  if (!A.analyser) return;


  const lo = A.analyser.minDecibels, span = A.analyser.maxDecibels - lo;
  let bass = 0, nb = 0, mid = 0, nm = 0, high = 0, nh = 0, level = 0, low = 0, peak = 0, sflux = 0, srise = 0, ns = 0, nflux = 0, ncent = 0, hflux = 0;
  for (let i = 0; i < BANDS; i++) {
    let m = -Infinity;
    for (let b = A.binOf[i]; b <= Math.max(A.binOf[i], A.binOf[i + 1] - 1); b++) m = Math.max(m, A.freq[b]);
    // Gentle tilt so the top end is not starved (real music falls ~3 dB/oct).
    let v = (m - lo) / span + (i / BANDS) * 0.18;
    v = Math.min(1, Math.max(0, v)); v = v * v * (3 - 2 * v);
    const f = A.bandHz[i];
    if (f < 150) low += v;
    if (f > 900 && f < 5200) { const d = v - A.prevV[i]; if (d > 0) sflux += d; if (d > 0.05) srise++; ns++; }
    { const d = v - A.prevV[i]; if (d > 0) { if (f > 250 && f < 2500) { nflux += d; ncent += d * i; } else if (f > 6000) hflux += d; } }
    A.prevV[i] = v; peak = Math.max(peak, v);
    v = Math.min(1, v * A.agc);
    A.bands[i] = env(A.bands[i], v, dt, 40, 9);            // light
    A.bandsM[i] = env(A.bandsM[i], v, dt, 20, 5);          // what the waterfall records
    A.bandsS[i] = env(A.bandsS[i], v, dt, 12, 2.6);        // geometry
    A.specU8[i * 2] = A.bands[i] * 255; A.specU8[i * 2 + 1] = A.bandsS[i] * 255;
    if (f < 150) { bass += v; nb++; } else if (f < 2200) { mid += v; nm++; } else if (f > 3500 && f < 12000) { high += v; nh++; }
    level += v;
  }
  bass /= nb; mid /= nm; high /= nh; level /= BANDS;
  A.bass = env(A.bass, bass, dt, 30, 6); A.mid = env(A.mid, mid, dt, 22, 5); A.high = env(A.high, high, dt, 30, 7); A.level = env(A.level, level, dt, 18, 4);
  A.bassS = env(A.bassS, bass, dt, 10, 2.5); A.midS = env(A.midS, mid, dt, 9, 2.2); A.highS = env(A.highS, high, dt, 10, 2.5); A.levelS = env(A.levelS, level, dt, 8, 2);
  // Section dynamics: the energy against its own slow average and recent peak.
  const e = 0.5 * A.bassS + 0.5 * A.levelS;
  A.ePeak = Math.max(e, A.ePeak * Math.exp(-dt / 25), 0.15);
  A.dyn = env(A.dyn, Math.min(1, e / A.ePeak), dt, 2.2, 1.1);
  A.sinceDrop += dt;
  if (e > A.eLong * 1.3 + 0.03 && A.sinceDrop > 6) { A.dropR = 1; A.sinceDrop = 0; A.accentR = 1; A.accents++; A.sinceAccent = 0; }
  A.eLong = env(A.eLong, e, dt, 0.35, 0.35);
  A.dropR *= Math.exp(-dt * 1.1);
  A.dropA = env(A.dropA, A.dropR, dt, 9, 9); A.drop = env(A.drop, A.dropA, dt, 9, 9);
  // Quiet material is lifted (never more than ×2.2) so a soft master still moves the picture; loud material is left alone.
  A.agcPeak = Math.max(peak, A.agcPeak * Math.exp(-dt / 6));
  A.agc = env(A.agc, Math.min(2.2, Math.max(1, 0.92 / Math.max(A.agcPeak, 0.2))), dt, 3, 0.5);
  // Kick: positive flux in the low bands against an adaptive threshold.
  const flux = Math.max(0, low - A.prevLow); A.prevLow = low;
  A.fluxAvg = A.fluxAvg * 0.94 + flux * 0.06;
  if (flux > A.fluxAvg * 2.2 + 0.25 && A.kickF < 0.35) { A.kickF = 1; A.kickR = 1; A.beat++;
    A.kickAmp = flux / (A.fluxAvg * 2.2 + 0.25);
    if ((A.kickAmp > A.kMean * 1.15 && A.sinceAccent > 1.7) || A.sinceAccent > 3.5) { A.accentR = 1; A.accents++; A.sinceAccent = 0; }
    A.kMean += (A.kickAmp - A.kMean) * 0.2;
    if (A.sincePulse > 0.4) { A.pulse[A.pulseAt++ & 7] = 0; A.sincePulse = 0; } }
  A.kickF *= Math.exp(-dt * 6.5);
  // Snare / clap: a broadband rise through the mids. It needs breadth as well as size, so a melody note does not fire it.
  A.sfluxAvg = A.sfluxAvg * 0.94 + sflux * 0.06;
  if (sflux > A.sfluxAvg * 2.4 + 0.02 * ns && srise > ns * 0.4 && A.snareF < 0.35) { A.snareF = 1; A.snareR = 1; A.snares++; }
  A.snareF *= Math.exp(-dt * 6.5);
  // The eased impulses: held with a ~0.3 s release, then run through two one-pole stages so they start with
  // zero slope. They peak near 0.8, which the 1.25 brings back to about 1.
  A.kickR *= Math.exp(-dt * 3.6); A.snareR *= Math.exp(-dt * 4.2);
  A.kickA = env(A.kickA, Math.max(0, A.kickR - 0.15) / 0.85 * 1.25, dt, 34, 34); A.kick = env(A.kick, A.kickA, dt, 34, 34);
  A.snareA = env(A.snareA, Math.max(0, A.snareR - 0.15) / 0.85 * 1.25, dt, 34, 34); A.snare = env(A.snare, A.snareA, dt, 34, 34);
  A.kickL = env(A.kickL, A.kickF * 1.3, dt, 48, 30);
  A.accentR *= Math.exp(-dt * 0.9); A.accentA = env(A.accentA, A.accentR, dt, 6, 6); A.accent = env(A.accent, A.accentA, dt, 6, 6);
  // Notes and hats: onsets in the mids and in the top octave.
  A.sinceNote += dt; A.sinceHat += dt; A.sinceAccent += dt;
  if (nflux > A.nAvg * 1.7 + 0.5 && A.sinceNote > 0.1) { A.notes++; A.noteBand = ncent / nflux / BANDS; A.noteAmp = Math.min(1, nflux / (A.nAvg * 4 + 1.5)); A.sinceNote = 0; }
  if (hflux > A.hAvg * 1.8 + 0.6 && A.sinceHat > 0.07) { A.hats++; A.hatAmp = Math.min(1, hflux / (A.hAvg * 4 + 2)); A.sinceHat = 0; }
  A.nAvg = A.nAvg * 0.95 + nflux * 0.05; A.hAvg = A.hAvg * 0.95 + hflux * 0.05;
  A.bassVS = env(A.bassVS, bass, dt, 1.4, 1.1); A.levelVS = env(A.levelVS, level, dt, 1.2, 0.9);
  A.slowRow[0] = A.dyn; A.slowRow[1] = A.accent; A.slowRow[2] = A.bassVS; A.slowRow[3] = A.levelVS;
  // Waveform: start at an upward zero crossing so successive frames line up, then average a little over time.
  let z = 64; const tm = A.time, wk = 1 - Math.exp(-dt * 14);
  for (let i = 64; i < 1000; i++) if (tm[i - 1] < 0 && tm[i] >= 0 && tm[i + 3] > tm[i]) { z = i; break; }
  for (let i = 0; i < WAVE; i++) { const k = z + i * 6; const s = (tm[k] + tm[k + 1] + tm[k + 2]) / 3;
    A.wave[i] += (s - A.wave[i]) * wk; A.waveU8[i] = Math.max(0, Math.min(255, (A.wave[i] * 0.5 + 0.5) * 255)); }
  // One waterfall row: the medium bands, halved and lightly smoothed across frequency.
  for (let c = 0; c < HIST_W; c++) { const i = c * 2;
    A.histRow[c] = (A.bandsM[Math.max(0, i - 1)] + 2 * A.bandsM[i] + 2 * A.bandsM[i + 1] + A.bandsM[Math.min(BANDS - 1, i + 2)]) / 6; }
}


// 20_gl.js
const HDR = !!gl.getExtension('EXT_color_buffer_float');
gl.getExtension('OES_texture_float_linear');
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

const VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
out vec2 uv; void main(){ vec2 q = P[gl_VertexID]; uv = q*.5+.5; gl_Position = vec4(q,0.,1.); }`;

// The inputs every scene shader may read. A scene lists the ones it uses in its `inputs`, so a port knows
// exactly what to feed it. Geometry reads the S (slow) values and uKick; light may read the fast ones.
const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
`;
const LIB = `
uniform float uTime, uBass, uMid, uHigh, uLevel, uBassS, uMidS, uHighS, uLevelS, uKick, uKickL, uSnare;
uniform float uDyn, uDrop, uAccent, uSlowHead; uniform sampler2D uSlow;
// The slow history: x dyn, y accent, z slow bass, w slow level; age 0 is now, 1 is about 17 seconds ago.
vec4 slowH(float age){ return texture(uSlow, vec2(uSlowHead-clamp(age,0.,1.)*${(508 / 512).toFixed(6)}, .5)); }
uniform float uHue, uTravel, uHistHead, uTan, uAspect, uPalMix, uPx;
uniform float uPulse[8]; uniform vec2 uRes; uniform sampler2D uSpec, uWave, uHist;
uniform mat4 uVP; uniform vec3 uEye, uCamR, uCamU, uCamF; uniform vec3 uPA[4], uPB[4];
const float PI = 3.14159265, TAU = 6.2831853;
float spec(float x){ return texture(uSpec, vec2(clamp(x,0.,1.), .5)).r; }     // fast: light
float specS(float x){ return texture(uSpec, vec2(clamp(x,0.,1.), .5)).g; }    // slow: geometry
float wave(float x){ return texture(uWave, vec2(fract(x), .5)).r*2.-1.; }
// Waterfall: f is frequency 0..1, age runs from 0 (now) to 1 (about four seconds ago). The head is fractional,
// so the history slides by a fraction of a row each frame instead of stepping.
float hist(float f, float age){ return texture(uHist, vec2(clamp(f,.004,.996), uHistHead - clamp(age,0.,1.)*${((HIST_H - 3) / HIST_H).toFixed(6)})).r; }
// A band of light (or lift) that leaves on each kick, travelling at 'speed' and 'width' wide, and fades in and
// out over 'life' seconds (keep life under 3 s). Eight can be out at once, so none ever has to snap back.
float ring(float x, float speed, float width, float life){ float s = 0.;
  for (int i = 0; i < 8; i++){ float a = uPulse[i], d = (x-a*speed)/width;
    s += smoothstep(0.,.14,a)*(1.-smoothstep(life*.45,life,a))*exp(-d*d); }
  return s; }
float hash(vec3 p){ p = fract(p*.3183099+.1); p *= 17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
uint pcg(uint v){ uint s = v*747796405u+2891336453u; uint w = ((s>>((s>>28u)+4u))^s)*277803737u; return (w>>22u)^w; }
float hashu(uint v){ return float(pcg(v)>>8)*(1./16777216.); }      // a clean per-particle random number, 0..1
float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
vec3 hash3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453); }
float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x), f.y), f.z); }
float fbm(vec3 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++){ s += a*noise(p); p = p*2.03+vec3(1.7,9.2,3.1); a *= .5; } return s; }
// Palettes are cosine ramps a + b·cos(2π(c·t + d)); two are bound so a palette change can cross-fade.
vec3 palOf(vec3 p[4], float t){ return p[0]+p[1]*cos(TAU*(p[2]*t+p[3])); }
vec3 pal(float t){ t += uHue; vec3 c = palOf(uPA, t); return uPalMix > 0. ? mix(c, palOf(uPB, t), uPalMix) : c; }
// The same ramp at full strength: the dark stretches are lifted so emissive lines never go muddy.
vec3 vivid(float t){ vec3 c = max(pal(t), 0.); return c/(max(c.r,max(c.g,c.b))+.12); }
// Fully saturated: for light sources and anything meant to read as neon.
vec3 neon(float t){ vec3 c = max(pal(t), 0.); float m = max(c.r,max(c.g,c.b)), n = min(c.r,min(c.g,c.b)); return (c-n*.8)/(m-n*.8+.04); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c,-s,s,c); }
// Voronoi cells in 3D: distance to the nearest and second-nearest site, and the nearest site's id.
vec3 cells(vec3 p){ vec3 ip = floor(p), fp = fract(p); float f1 = 9., f2 = 9., id = 0.;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec3 g = vec3(float(i),float(j),float(k)), h = hash3(ip+g), r = g+h-fp; float d = dot(r,r);
    if (d < f1){ f2 = f1; f1 = d; id = h.x; } else if (d < f2) f2 = d; }
  return vec3(sqrt(f1), sqrt(f2), id); }
// Octahedral map: the unit square folds onto the whole sphere with no poles.
vec3 octDir(vec2 a){ vec2 e = a*2.-1.; vec3 v = vec3(e.x, 1.-abs(e.x)-abs(e.y), e.y);
  if (v.y < 0.) v.xz = (1.-abs(v.zx))*vec2(v.x < 0. ? -1. : 1., v.z < 0. ? -1. : 1.);
  return normalize(v); }
vec2 octUV(vec3 d){ d /= abs(d.x)+abs(d.y)+abs(d.z); vec2 e = d.xz;
  if (d.y < 0.) e = (1.-abs(e.yx))*vec2(e.x < 0. ? -1. : 1., e.y < 0. ? -1. : 1.);
  return e*.5+.5; }
`;
const FSLIB = `
vec3 viewRay(){ vec2 q = gl_FragCoord.xy/uRes*2.-1.; return normalize(uCamF + uCamR*(q.x*uTan*uAspect) + uCamU*(q.y*uTan)); }
float stars(vec3 rd){ vec3 p = rd*95.; vec3 c = floor(p); float h = hash(c);
  vec3 j = vec3(hash(c+7.1), hash(c+13.7), hash(c+3.3)); float d = length(fract(p)-.5-(j-.5)*.6);
  return step(.93, h)*exp(-d*d*85.)*(.55+.45*sin(uTime*(1.+h*3.)+h*90.))*(.3+2.*fract(h*37.)); }
`;
const FSH = HEAD + LIB + FSLIB;                                     // fragment shaders
const VSH = HEAD + LIB + 'layout(location=0) in vec2 aUV;\n';      // grid-mesh vertex shaders
const VSP = HEAD + LIB;                                             // point / instanced vertex shaders
const FS_POINT = `#version 300 es
precision highp float; in vec3 vCol; out vec4 o;
void main(){ vec2 q = gl_PointCoord*2.-1.; float d = dot(q,q); if (d > 1.) discard; o = vec4(vCol*exp(-d*4.5), 1.); }`;

// ───────────── Post chain: (depth of field) → cross-fade → trails → bloom → lens, tone map, grain ─────────────
// Depth of field. Scenes that want it write linear view depth to alpha; this is a single-pass spiral gather
// (the scatter-as-gather idea described by Dennis Gustafsson, 2018; code written here).
// Phones / TVs: 32 taps a pixel is the single most expensive post step; drop to 12 taps or skip it.
const FS_DOF = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uPx; uniform float uFocus, uAperture, uMaxCoc;
float coc(float d){ return clamp(abs(d-uFocus)/max(d,1e-3)*uAperture, 0., uMaxCoc); }
void main(){
  vec4 c0 = texture(uSrc, uv); float s0 = coc(c0.a);
  vec3 acc = c0.rgb; float tot = 1.;
  float jit = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(.06711056,.00583715))))*6.2831853;
  const int N = ${stage.constrained ? 12 : 32};
  for (int i = 1; i <= N; i++){
    float r = sqrt(float(i)/float(N))*uMaxCoc, a = float(i)*2.39996323+jit;
    vec4 c = texture(uSrc, uv+vec2(cos(a),sin(a))*r*uPx); float s = coc(c.a);
    if (c.a > c0.a) s = min(s, s0*2.);            // a blurred background never spills over a sharp foreground
    float m = smoothstep(r-.5, r+.5, s);
    acc += mix(acc/tot, min(c.rgb, vec3(24.)), m); tot += 1.;
  }
  o = vec4(acc/tot, c0.a);
}`;
// Scene cross-fade, in HDR and before the trails, so both scenes share one set of trails and one bloom.
const FS_MIX = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D uA, uB; uniform float uMix;
void main(){ o = vec4(mix(max(texture(uA, uv).rgb, 0.), max(texture(uB, uv).rgb, 0.), uMix), 1.); }`;
const FS_COPY = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D uA; void main(){ o = texture(uA, uv); }`;
const FS_TRAIL = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D uCur, uPrev; uniform float uDecay, uZoom, uSpin;
void main(){
  vec2 c = uv-.5; float cs = cos(uSpin), sn = sin(uSpin); c = mat2(cs,-sn,sn,cs)*c*(1.-uZoom);
  vec3 prev = texture(uPrev, c+.5).rgb*uDecay;
  vec3 cur = texture(uCur, uv).rgb;
  if (any(isnan(cur)) || any(isinf(cur))) cur = vec3(0.);
  if (any(isnan(prev)) || any(isinf(prev))) prev = vec3(0.);
  o = vec4(max(max(cur, prev), 0.), 1.);
}`;
// Bloom: soft-knee threshold with a brightness-weighted first tap (no fireflies), a dual-filter pyramid down,
// then each level is blended into the one above so the halo has a tight core and a long tail.
const FS_PRE = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D uSrc; uniform vec2 uHalf; uniform float uThr, uKnee;
vec4 tap(vec2 p){ vec3 c = min(texture(uSrc,p).rgb, vec3(48.)); float b = max(c.r,max(c.g,c.b));
  float s = clamp(b-uThr+uKnee, 0., 2.*uKnee); s = s*s/(4.*uKnee+1e-4);
  c *= max(s, b-uThr)/max(b,1e-4); float w = 1./(1.+max(c.r,max(c.g,c.b))); return vec4(c*w, w); }
void main(){ vec4 s = tap(uv+uHalf)+tap(uv-uHalf)+tap(uv+vec2(uHalf.x,-uHalf.y))+tap(uv-vec2(uHalf.x,-uHalf.y)); o = vec4(s.rgb/max(s.a,1e-4), 1.); }`;
const FS_DOWN = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D uSrc; uniform vec2 uHalf;
void main(){ vec3 s = texture(uSrc,uv).rgb*4.;
  s += texture(uSrc,uv-uHalf).rgb + texture(uSrc,uv+uHalf).rgb + texture(uSrc,uv+vec2(uHalf.x,-uHalf.y)).rgb + texture(uSrc,uv-vec2(uHalf.x,-uHalf.y)).rgb;
  o = vec4(s/8., 1.); }`;
const FS_UP = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D uSrc, uAdd; uniform vec2 uHalf; uniform float uSpread;
void main(){ vec2 h = uHalf; vec3 s = vec3(0.);
  s += texture(uSrc, uv+vec2(-h.x*2.,0.)).rgb + texture(uSrc, uv+vec2(h.x*2.,0.)).rgb + texture(uSrc, uv+vec2(0.,-h.y*2.)).rgb + texture(uSrc, uv+vec2(0.,h.y*2.)).rgb;
  s += (texture(uSrc, uv+vec2(-h.x,h.y)).rgb + texture(uSrc, uv+h).rgb + texture(uSrc, uv+vec2(h.x,-h.y)).rgb + texture(uSrc, uv-h).rgb)*2.;
  o = vec4(mix(texture(uAdd, uv).rgb, s/12., uSpread), 1.); }`;
// Final: chromatic aberration, bloom, highlight roll-off to white, ACES, vignette, grain.
const FS_FINAL = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D uScene, uBloom; uniform float uKick, uTime, uFade, uBloomAmt, uExposure, uCA, uVig, uGrain, uPulseAmt; uniform vec2 uRes;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))+fract(uTime)*17.)*43758.5453); }
void main(){
  vec2 d = uv-.5; float ca = uCA*(.0012+uKick*.004*uPulseAmt)*(.4+2.4*dot(d,d));
  vec3 c;
  c.r = texture(uScene, uv+d*ca).r + uBloomAmt*texture(uBloom, uv+d*ca*1.6).r;
  c.g = texture(uScene, uv).g + uBloomAmt*texture(uBloom, uv).g;
  c.b = texture(uScene, uv-d*ca).b + uBloomAmt*texture(uBloom, uv-d*ca*1.6).b;
  c = max(c*uExposure, 0.);
  // Very bright saturated light burns toward white instead of clipping to a flat primary.
  float pk = max(c.r, max(c.g, c.b)); c = mix(c, vec3(pk), smoothstep(1.2, 9., pk)*.55);
  c = aces(c);
  c *= 1.-dot(d,d)*uVig;
  c = pow(c, vec3(1./2.2));
  float g = h(uv*uRes)-.5; c += g*uGrain*(1.-.6*dot(c,vec3(.33)));
  o = vec4(c*uFade, 1.);
}`;

function compile(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); const m = /0:(\d+)/.exec(log); const ln = m ? +m[1] : 0;
    throw new Error('shader: ' + log + '\n' + src.split('\n').slice(Math.max(0, ln - 3), ln + 2).join('\n')); } return s; }
function program(vs, fs) { const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
  return { p, u: new Proxy(u, { get: (o, k) => (k in o ? o[k] : null) }) }; }

const POST = { dof: program(VS, FS_DOF), mix: program(VS, FS_MIX), copy: program(VS, FS_COPY), trail: program(VS, FS_TRAIL),
  pre: program(VS, FS_PRE), down: program(VS, FS_DOWN), up: program(VS, FS_UP), final: program(VS, FS_FINAL) };
const vao = gl.createVertexArray(); gl.bindVertexArray(vao);

// A square grid of (n+1)² vertices carrying only their 0..1 coordinates; the vertex shaders bend it into a
// plain, an island, a globe or an octahedral sphere. Phones: the 384 grid is 295k triangles, use 192.
const GRIDS = {};
function grid(n) {
  if (GRIDS[n]) return GRIDS[n];
  const v = new Float32Array((n + 1) * (n + 1) * 2); let k = 0;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { v[k++] = i / n; v[k++] = j / n; }
  const idx = new Uint32Array(n * n * 6); k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = d; idx[k++] = c; }
  const va = gl.createVertexArray(); gl.bindVertexArray(va);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(vao);
  return GRIDS[n] = { vao: va, count: idx.length };
}

function tex1D(w, fmt, base) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, 1, 0, base, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
const specTex = tex1D(BANDS, gl.RG8, gl.RG), waveTex = tex1D(WAVE, gl.R8, gl.RED);
gl.bindTexture(gl.TEXTURE_2D, waveTex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
// The waterfall is a ring buffer: one row is overwritten each tick and the shaders follow the head.
const histTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, histTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, HIST_W, HIST_H, 0, gl.RED, gl.FLOAT, new Float32Array(HIST_W * HIST_H));
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
let histHead = 0, histAcc = 0;
const slowTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, slowTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 512, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(512 * 4));
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
let slowHead = 0, slowU = 0;

function target(w, h, fmt, filter) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  fmt = fmt || (HDR ? gl.RGBA16F : gl.RGBA8); filter = filter || gl.LINEAR;
  if (fmt === gl.RGBA8) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, gl.RGBA, fmt === gl.RGBA32F ? gl.FLOAT : gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Unsupported visualizer framebuffer');
  return { t, f, w, h };
}
const freeTarget = o => { if (o) { gl.deleteTexture(o.t); gl.deleteFramebuffer(o.f); } };
// Multisampled HDR colour + depth for the mesh scenes, resolved into the scene's own buffer.
const colorSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, HDR ? gl.RGBA16F : gl.RGBA8, gl.SAMPLES);
const depthSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES);
const SAMPLES = Array.from(colorSamples).find(n => n <= (stage.constrained ? 2 : 4) && depthSamples.includes(n)) || 0;
function msTarget(w, h) {
  const f = gl.createFramebuffer(), c = gl.createRenderbuffer(), d = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, c); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, SAMPLES, HDR ? gl.RGBA16F : gl.RGBA8, w, h);
  gl.bindRenderbuffer(gl.RENDERBUFFER, d); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, SAMPLES, gl.DEPTH_COMPONENT24, w, h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Unsupported visualizer framebuffer');
  return { f, c, d, w, h };
}

// Render targets are made on demand at the current render size and all rebuilt when it changes; the trails
// are carried across so a change of resolution never wipes them.
// The pixel budget caps the internal resolution (the canvas itself stays at device size); the governor below
// lowers it further if the display cannot hold its frame rate. Phones: start around 0.9e6, TVs 1.3e6.
let T = null, DPR = 1, budgetScale = 1;
const LEVELS = 6, BUDGET = 2.4e6;
function RT(name) { return T.pool[name] || (T.pool[name] = target(T.sw, T.sh)); }
function resize() {
  DPR = 1;
  const w = Math.floor(innerWidth * DPR), h = Math.floor(innerHeight * DPR);
  canvas.width = w; canvas.height = h;
  const k = Math.sqrt(budgetScale);
  const sw = Math.max(2, Math.floor(w * k)), sh = Math.max(2, Math.floor(h * k));
  const old = T, down = [], up = [];
  let dw = sw >> 1, dh = sh >> 1;
  for (let i = 0; i < LEVELS; i++) { down.push(target(Math.max(2, dw), Math.max(2, dh))); dw >>= 1; dh >>= 1; }
  for (let i = 0; i < LEVELS - 1; i++) up.push(target(down[i].w, down[i].h));
  T = { pool: {}, ms: msTarget(sw, sh), down, up, sw, sh, w, h, flip: old ? old.flip : false };
  if (old) {
    for (const name of ['trail0', 'trail1', 'still', 'mix']) if (old.pool[name])
      draw(POST.copy, RT(name), sw, sh, u => { bindTex(0, old.pool[name].t); gl.uniform1i(u.uA, 0); });
    Object.values(old.pool).forEach(freeTarget); old.down.forEach(freeTarget); old.up.forEach(freeTarget);
    gl.deleteFramebuffer(old.ms.f); gl.deleteRenderbuffer(old.ms.c); gl.deleteRenderbuffer(old.ms.d);
  }
}

function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
function draw(prog, fbo, w, h, set) { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo ? fbo.f : null); gl.viewport(0, 0, w, h); gl.useProgram(prog.p); set && set(prog.u); gl.drawArrays(gl.TRIANGLES, 0, 3); }
function quad(prog, set) { gl.useProgram(prog.p); set && set(prog.u); gl.drawArrays(gl.TRIANGLES, 0, 3); }
function mesh(prog, g, set) { gl.useProgram(prog.p); set && set(prog.u); gl.bindVertexArray(g.vao); gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0); gl.bindVertexArray(vao); }
function points(prog, n, set) { gl.useProgram(prog.p); set && set(prog.u); gl.drawArrays(gl.POINTS, 0, n); }
// Scenes draw either straight into `out` (full-screen shaders, additive points) or through the multisampled buffer.
function beginTo(out) { gl.bindFramebuffer(gl.FRAMEBUFFER, out.f); gl.viewport(0, 0, T.sw, T.sh); }
function beginMS() { gl.bindFramebuffer(gl.FRAMEBUFFER, T.ms.f); gl.viewport(0, 0, T.sw, T.sh); gl.depthMask(true); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.disable(gl.DEPTH_TEST); }
function endMS(out) { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.ms.f); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, out.f);
  gl.blitFramebuffer(0, 0, T.sw, T.sh, 0, 0, T.sw, T.sh, gl.COLOR_BUFFER_BIT, gl.NEAREST); }
function resetState() { gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.depthMask(true); gl.colorMask(true, true, true, true); gl.depthFunc(gl.LESS); gl.cullFace(gl.BACK); gl.bindVertexArray(vao); }

// Small vector and matrix helpers, and a camera that keeps its basis so sky shaders can rebuild the view ray.
function persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp,0,0,0, 0,t,0,0, 0,0,(f + n) / (n - f),-1, 0,0,2 * f * n / (n - f),0]; }
function mul(a, b) { const r = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; r[i * 4 + j] = s; } return r; }
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]], dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const orbit = (az, el, R) => [Math.sin(az) * R * Math.cos(el), Math.sin(el) * R, Math.cos(az) * R * Math.cos(el)];
function camera(eye, tgt, fov, roll, near, far) {
  const f = norm(sub(tgt, eye)); let r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll); const r2 = [r[0]*c+u[0]*s, r[1]*c+u[1]*s, r[2]*c+u[2]*s]; u = [u[0]*c-r[0]*s, u[1]*c-r[1]*s, u[2]*c-r[2]*s]; r = r2; }
  const view = [r[0],u[0],-f[0],0, r[1],u[1],-f[1],0, r[2],u[2],-f[2],0, -dot(r,eye),-dot(u,eye),dot(f,eye),1];
  return { eye, r, u, f, tan: Math.tan(fov / 2), vp: mul(persp(fov, T.sw / T.sh, near, far), view) };
}
function setCam(u, c) { gl.uniformMatrix4fv(u.uVP, false, c.vp); gl.uniform3fv(u.uEye, c.eye); gl.uniform3fv(u.uCamR, c.r); gl.uniform3fv(u.uCamU, c.u); gl.uniform3fv(u.uCamF, c.f);
  gl.uniform1f(u.uTan, c.tan); gl.uniform1f(u.uAspect, T.sw / T.sh); }

// ═════════════════════════ 3 · Palettes and the scene registry ═════════════════════════
// One palette system: cosine ramps [a, b, c, d]. Each scene names the one it was graded for; the Colour
// key overrides it for every scene. Changes cross-fade.
const PALETTES = [
  { name: 'Cobalt',   v: [.5,.5,.5, .5,.5,.5, 1,1,1, .55,.65,.85] },
  { name: 'Spectrum', v: [.5,.5,.5, .5,.5,.5, 1,.9,.8, 0,.33,.67] },
  { name: 'Opal',     v: [.62,.55,.48, .45,.4,.35, 1,1,.5, .8,.9,.3] },
  { name: 'Ember',    v: [.5,.5,.5, .5,.5,.5, 1,1,1, 0,.1,.2] },
  { name: 'Synth',    v: [.5,.45,.8, .5,.45,.2, 1,1,1, 0,.5,.25] },
  { name: 'Glacier',  v: [.3,.6,.75, .3,.35,.25, 1,1,1, .45,.15,0] },
  { name: 'Borealis', v: [.4,.6,.675, .3,.4,.225, 1,1,1, .5,0,.5] },
].map(p => ({ name: p.name, v: new Float32Array(p.v) }));

// The scene API. A scene is one object:
//   id, name, from, kind        identity ('from' is the set its concept came from)
//   about                       one line for the picker
//   inputs                      the audio inputs it reads (see the table at the top of the audio section)
//   cost                        what will be expensive on a phone or TV, and the cheap fallback
//   pal                         index of the palette it was graded for;  hue(t) optional hue drift
//   post                        trails, bloom, exposure, lens and optional depth of field
//   init()                      compile programs, build buffers (called once, lazily)
//   draw(F, out)                render one frame into `out` (an HDR target); F carries time, dt, travel, the
//                               audio state A, F.set(u) to bind the shared uniforms, and F.focus for DOF
// A scene touches nothing outside itself except the helpers in section 2, so each one lifts out as a module.
const SCENES = [];
// pulse: how much the lens itself (bloom, colour fringing) swells on the kick; 1 is the old behaviour, 0 is none
const POST_DEFAULT = { trail: 0, zoom: 0, spin: 0, bloom: 0.5, thr: 0.8, knee: 0.5, spread: 0.7, exp: 1, ca: 0.5, vig: 0.85, grain: 0.022, pulse: 1 };
function scene(def) { def.post = Object.assign({}, POST_DEFAULT, def.post); SCENES.push(def); }

// 25_helpers.js

// ───────────── Shared helpers for scenes: reduced-resolution targets, a 2D fluid solver, a text atlas ─────────────
// A scene-owned target at 1/div of the render size, rebuilt with the rest when the size changes. Soft volumes
// (nebula, aurora) are marched at half size and enlarged; that is a 4× saving and the right first cut on phones.
function RTs(name, div) { return T.pool[name] || (T.pool[name] = target(Math.max(2, Math.ceil(T.sw / div)), Math.max(2, Math.ceil(T.sh / div)))); }
// A persistent simulation target of a fixed size (not tied to the screen), for scenes that keep state.
function simTarget(w, h, fmt, filter) { const t = target(w, h, fmt || (HDR ? gl.RGBA16F : gl.RGBA8), filter || gl.LINEAR);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); return t; }

// A small incompressible-flow solver on a grid (the method of Jos Stam's "Stable Fluids", 1999: semi-Lagrangian
// advection and a Jacobi pressure projection, plus vorticity confinement; the code is written here).
// Velocity is in screen heights per second. A scene supplies two fragment shaders: `force` returns the new
// velocity given uVel and uDye (add wind, buoyancy, stirring), and `dye` returns the new dye given uDye and uVel
// (add pigment, fade it). Phones: a 128×72 grid with 10 pressure iterations is plenty.
const FLUID_SRC = {
  advect: `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D uVel, uSrc; uniform float uDt, uKeep, uAsp, uWall;
void main(){ vec2 v = texture(uVel, uv).xy; vec4 c = texture(uSrc, uv-uDt*v*vec2(1./uAsp, 1.))*uKeep;
  if (uWall > 0.){ vec2 e = min(uv, 1.-uv); c.xy *= smoothstep(0., uWall, e.x)*smoothstep(0., uWall, e.y); }
  o = c; }`,
  curl: `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D uVel; uniform vec2 uTx;
void main(){ float c = (texture(uVel, uv+vec2(uTx.x,0.)).y-texture(uVel, uv-vec2(uTx.x,0.)).y)-(texture(uVel, uv+vec2(0.,uTx.y)).x-texture(uVel, uv-vec2(0.,uTx.y)).x);
  o = vec4(c*.5, 0., 0., 1.); }`,
  vort: `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D uVel, uCurl; uniform vec2 uTx; uniform float uDt, uVort;
void main(){ float c = texture(uCurl, uv).x;
  vec2 g = vec2(abs(texture(uCurl, uv+vec2(uTx.x,0.)).x)-abs(texture(uCurl, uv-vec2(uTx.x,0.)).x), abs(texture(uCurl, uv+vec2(0.,uTx.y)).x)-abs(texture(uCurl, uv-vec2(0.,uTx.y)).x));
  g /= length(g)+1e-5; o = vec4(texture(uVel, uv).xy+uVort*uDt*c*vec2(g.y, -g.x), 0., 1.); }`,
  div: `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D uVel; uniform vec2 uTx;
void main(){ o = vec4(.5*((texture(uVel, uv+vec2(uTx.x,0.)).x-texture(uVel, uv-vec2(uTx.x,0.)).x)+(texture(uVel, uv+vec2(0.,uTx.y)).y-texture(uVel, uv-vec2(0.,uTx.y)).y)), 0., 0., 1.); }`,
  jacobi: `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D uPrs, uDiv; uniform vec2 uTx; uniform float uKeep;
void main(){ o = vec4(((texture(uPrs, uv+vec2(uTx.x,0.)).x+texture(uPrs, uv-vec2(uTx.x,0.)).x+texture(uPrs, uv+vec2(0.,uTx.y)).x+texture(uPrs, uv-vec2(0.,uTx.y)).x)*uKeep-texture(uDiv, uv).x)*.25, 0., 0., 1.); }`,
  grad: `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D uVel, uPrs; uniform vec2 uTx;
void main(){ o = vec4(texture(uVel, uv).xy-.5*vec2(texture(uPrs, uv+vec2(uTx.x,0.)).x-texture(uPrs, uv-vec2(uTx.x,0.)).x, texture(uPrs, uv+vec2(0.,uTx.y)).x-texture(uPrs, uv-vec2(0.,uTx.y)).x), 0., 1.); }`,
};
let FLUID = null;
function Fluid(w, h, dw, dh) {
  if (!FLUID) { FLUID = {}; for (const k in FLUID_SRC) FLUID[k] = program(VS, FLUID_SRC[k]); }
  const mk = (W, H) => simTarget(W, H);
  Object.assign(this, { w, h, dw, dh, v: [mk(w, h), mk(w, h)], p: [mk(w, h), mk(w, h)], aux: mk(w, h), d: [mk(dw, dh), mk(dw, dh)] });
}
Fluid.prototype.step = function (dt, o) {
  const { w, h, dw, dh, v, p, aux, d } = this, tx = [1 / w, 1 / h], asp = w / h;
  const pass = (prog, dst, W, H, set) => draw(prog, dst, W, H, set);
  dt = Math.min(dt, 1 / 30);
  // velocity: carry itself along, take the scene's forces, keep its curls alive, then make it divergence-free
  pass(FLUID.advect, v[1], w, h, u => { bindTex(4, v[0].t); gl.uniform1i(u.uVel, 4); gl.uniform1i(u.uSrc, 4); gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uKeep, o.keepV === undefined ? 0.995 : o.keepV); gl.uniform1f(u.uAsp, asp); gl.uniform1f(u.uWall, o.wall || 0); });
  pass(o.force, v[0], w, h, u => { o.set(u); bindTex(4, v[1].t); gl.uniform1i(u.uVel, 4); bindTex(5, d[0].t); gl.uniform1i(u.uDye, 5); gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uAsp, asp); });
  let cur = 0;
  if (o.vort) {
    pass(FLUID.curl, aux, w, h, u => { bindTex(4, v[0].t); gl.uniform1i(u.uVel, 4); gl.uniform2fv(u.uTx, tx); });
    pass(FLUID.vort, v[1], w, h, u => { bindTex(4, v[0].t); gl.uniform1i(u.uVel, 4); bindTex(5, aux.t); gl.uniform1i(u.uCurl, 5); gl.uniform2fv(u.uTx, tx); gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uVort, o.vort); });
    cur = 1;
  }
  pass(FLUID.div, aux, w, h, u => { bindTex(4, v[cur].t); gl.uniform1i(u.uVel, 4); gl.uniform2fv(u.uTx, tx); });
  for (let i = 0, n = stage.constrained ? 10 : (o.iters || 18); i < n; i++) {
    pass(FLUID.jacobi, p[1], w, h, u => { bindTex(4, p[0].t); gl.uniform1i(u.uPrs, 4); bindTex(5, aux.t); gl.uniform1i(u.uDiv, 5); gl.uniform2fv(u.uTx, tx); gl.uniform1f(u.uKeep, i ? 1 : 0.8); });
    [p[0], p[1]] = [p[1], p[0]];
  }
  pass(FLUID.grad, v[1 - cur], w, h, u => { bindTex(4, v[cur].t); gl.uniform1i(u.uVel, 4); bindTex(5, p[0].t); gl.uniform1i(u.uPrs, 5); gl.uniform2fv(u.uTx, tx); });
  if (cur === 0) [v[0], v[1]] = [v[1], v[0]];
  // dye: carried by the flow, then the scene adds and fades it
  pass(FLUID.advect, d[1], dw, dh, u => { bindTex(4, v[0].t); gl.uniform1i(u.uVel, 4); bindTex(5, d[0].t); gl.uniform1i(u.uSrc, 5); gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uKeep, 1); gl.uniform1f(u.uAsp, asp); gl.uniform1f(u.uWall, 0); });
  pass(o.dye, d[0], dw, dh, u => { o.set(u); bindTex(4, v[0].t); gl.uniform1i(u.uVel, 4); bindTex(5, d[1].t); gl.uniform1i(u.uDye, 5); gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uAsp, asp); });
};

// Words as a texture: `labels` drawn in a grid of cells with the platform's text renderer. A port replaces
// this one function with its own text rasteriser (Core Text, Skia paragraph) and keeps the same atlas layout.
function textAtlas(labels, cols, cw, ch, font) {
  const rows = Math.ceil(labels.length / cols), c = document.createElement('canvas'); c.width = cols * cw; c.height = rows * ch;
  const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#fff'; x.font = font; x.textBaseline = 'middle'; x.textAlign = 'left';
  try { x.letterSpacing = '3px'; } catch (e) {}
  labels.forEach((s, i) => x.fillText(s, (i % cols) * cw + 6, ((i / cols) | 0) * ch + ch / 2 + 1, cw - 12));
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { t, cols, rows, n: labels.length };
}

// Calls fn(slot) for every kick pulse that has started since the last call (scenes use it to give each
// pulse a place of its own: where a drop lands, where a ripple starts).
function newPulses(last, fn) { for (let i = 0; i < 8; i++) { if (A.pulse[i] < last[i]) fn(i); last[i] = A.pulse[i]; } }
// Sample a fixed-aspect simulation so it covers the screen without stretching.
const COVER = `
vec2 cover(vec2 uv, float simAsp){ float a = uRes.x/uRes.y; return a > simAsp ? vec2(uv.x, (uv.y-.5)*(simAsp/a)+.5) : vec2((uv.x-.5)*(a/simAsp)+.5, uv.y); }`;

// 29_scenes.js

// ═════════════════════════ 4 · Scenes ═════════════════════════
// Landscapes and spheres are real meshes drawn with 4× MSAA into the HDR buffer; the rest are full-screen
// shaders or point clouds. Each block below is one self-contained scene.

// 31_wire.js

// ───────────────────────── Synthwire Valley: low-poly wire mountains, a mirror road and a barred sun ─────────────────────────
{
// The mesh vertices ARE the low-poly vertices: heights come from a hash on whole lattice coordinates, so a
// facet keeps its shape as it comes toward you. The lattice wraps every 4096 rows, seamlessly.
const WIRE_FN = `
uniform float uCell, uSnap, uRow;
float lat(vec2 c){ return hash2(vec2(c.x, mod(c.y, 4096.))); }
float lat8(vec2 c){ return hash2(vec2(c.x, mod(c.y, 512.))+17.3); }
float vnoise8(vec2 g){ vec2 i = floor(g/8.), f = fract(g/8.); f = f*f*(3.-2.*f);
  return mix(mix(lat8(i), lat8(i+vec2(1.,0.)), f.x), mix(lat8(i+vec2(0.,1.)), lat8(i+vec2(1.,1.)), f.x), f.y); }
const float ROAD = 3.4;
float wireH(vec2 g, float zl){                       // g: lattice column and world row; zl: distance ahead
  float ax = abs(g.x)*uCell, valley = smoothstep(ROAD, 17., ax), f = clamp((ax-ROAD)/82., 0., 1.);
  float s = specS(.015+f*.82), n = lat(g)*.42+vnoise8(g)*1.08;
  float sw = hist(.03+f*.25, max(zl,0.)/170.);                              // each beat's swell runs away up the valley
  return valley*(.25+n*n*(2.1+ax*.085))*((.3+1.9*s)*(.5+.75*uDyn)+.28*uKick+1.1*sw*sw);
}`;
const WIRE_SKY = `
vec3 wireSky(vec3 rd, float disc){                       // disc: 0 leaves the sun's face out (for the haze colour)
  float y = max(rd.y, 0.);
  vec3 col = mix(neon(.95)*.055+neon(.5)*.01, vec3(.004,.003,.016), 1.-exp(-y*5.));
  col += neon(.0)*.1*exp(-abs(rd.y)*22.)*(.4+uBassS+1.6*uKick+uDrop);                 // the horizon seam
  vec3 sd = normalize(vec3(0.,.15,1.)), sx = normalize(cross(vec3(0.,1.,0.), sd)), sy = cross(sd, sx);
  vec2 sp = vec2(dot(rd,sx), dot(rd,sy)); float front = step(0., dot(rd,sd));
  float R = .19, d = length(sp)-R, v = sp.y/R;
  // Bars: slits that drift down the disc and widen as they go. Each is born with no width, so none pops in.
  float k = clamp(.55-v*.55, 0., 1.), gap = .62*k*k, ph = fract(v*5.5+uTime*.11);
  float slit = mix(1., smoothstep(gap-.03, gap+.03, ph)*(1.-smoothstep(.97, 1., ph)), smoothstep(.0,.06,gap));
  vec3 top = vec3(1.,.74,.26)*.85+neon(.25)*.15, sun = mix(neon(.0), top, smoothstep(-.75,.8,v))*(.8+.8*uKick+.6*uDrop);
  col = mix(col, sun, smoothstep(.003,-.003,d)*front*slit*disc);
  col += mix(neon(.0), top, .4)*exp(-max(d,0.)*9.)*front*(.06+.12*uBassS+.3*uKick+.3*uDrop);
  float fa = .03+(atan(sp.y, abs(sp.x))/PI+.5)*.7, fan = (specS(fa-.03)+specS(fa)*2.+specS(fa+.03))*.25;                      // a corona whose reach at each angle is a band
  col += mix(neon(.0), top, .5)*smoothstep(.0, -.1, d-.03-.22*fan*fan)*smoothstep(-.02, .01, d)*front*(.06+.2*fan)*smoothstep(-.02,.02,rd.y);
  col += stars(rd)*.7*smoothstep(.12,.4,rd.y);
  return col;
}`;
const VS_WIRE = VSH + WIRE_FN + `
out vec3 vW; out vec2 vG; out float vDepth;
void main(){
  vec2 g = vec2(aUV.x*128.-64., aUV.y*128.-4.);
  vW = vec3(g.x*uCell, wireH(vec2(g.x, g.y+uRow), g.y*uCell-uSnap), g.y*uCell-uSnap); vG = g;
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_WIRE_SKY = FSH + WIRE_FN + WIRE_SKY + `
out vec4 o; void main(){ o = vec4(wireSky(viewRay(), 1.), 400.); }`;
const FS_WIRE = FSH + WIRE_FN + WIRE_SKY + `
in vec3 vW; in vec2 vG; in float vDepth; out vec4 o;
void main(){
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); if (n.y < 0.) n = -n;          // flat facets
  vec3 v = normalize(vW-uEye); float dist = length(vW-uEye), ax = abs(vW.x);
  vec2 fw = max(fwidth(vG), 1e-5), f = fract(vG), e = min(f, 1.-f)/fw;
  float far = 1.-smoothstep(.3,.9,max(fw.x,fw.y));
  float lq = max(1.-smoothstep(.35,1.35,e.x), 1.-smoothstep(.35,1.35,e.y))*far;
  float ld = (1.-smoothstep(.3,1.3, abs(f.x+f.y-1.)/max(fwidth(vG.x+vG.y), 1e-5)))*far;
  float band = clamp((ax-ROAD)/82., 0., 1.), s = spec(.015+band*.82), hi = smoothstep(.5, 3., vW.y);
  float lt = .02+band*.5+vW.y*.02; vec3 lc = neon(lt), col;
  if (ax < ROAD+.05){
    // the road: a dark mirror with lane marks, neon kerbs and the waveform down the middle
    vec3 r = reflect(v, vec3(0.,1.,0.)); r.y = abs(r.y)+.002;
    col = wireSky(normalize(r), 1.)*(.16+.4*pow(1.-max(-v.y,0.), 4.))*vec3(.8,.75,1.);
    float run = ring(dist, 70., 5., 1.6);                                  // each kick: light runs away down the road
    col += neon(.0)*lq*(.07+.7*run);
    col += (neon(.0)*.7+.3)*exp(-abs(ax-ROAD+.25)*22.)*(.25+.7*uBass+.6*uKick+2.2*run);
    float xw = wave(dist*.011)*(.12+.55*uLevelS);
    col += (neon(.5)*.6+.4)*exp(-abs(vW.x-xw)*(22.-dist*.1))*(.35+1.3*uLevel)*exp(-dist*.02);
  } else {
    float facet = clamp(dot(n, normalize(vec3(-.45,.6,-.35)))*.5+.5, 0., 1.);
    col = lc*(.008+.1*facet*facet)*(.4+hi)*(.6+1.6*s*s) + neon(.95)*pow(1.-max(dot(n,-v),0.), 3.)*.03;   // dark faceted glass
    col += (lc*lq*(.06+.3*hi+1.9*s*s*(.15+.85*hi)) + lc*ld*hi*(.03+.8*s*s))*(1.+1.4*uKick+uDrop+1.5*ring(dist, 70., 6., 1.6));                              // wires; diagonals only up high
    col += (lc*.5+.5)*lq*ld*hi*s*s*3.;                                                                  // nodes
  }
  col = mix(col, wireSky(normalize(vec3(v.x, .012, v.z)), 0.), 1.-exp(-dist*.017));
  o = vec4(col, vDepth);
}`;
scene({ id: 'wire', name: 'Synthwire Valley', from: 'Neon', kind: 'terrain', group: 'refined', pal: 4,
  about: 'Low-poly wire mountains either side of a mirror road, under a barred sunset sun; the peaks ride the spectrum',
  inputs: ['specS', 'spec', 'hist', 'wave', 'bassS', 'levelS', 'bass', 'level', 'kick', 'pulse', 'dyn', 'drop', 'travel'],
  cost: 'Cheap: 33k triangles. The road evaluates the sky a second time for its reflection.',
  post: { trail: 0.12, bloom: 0.42, thr: 0.9, ca: 0.6, vig: 0.85, pulse: 0.25 },
  init() { this.sky = program(VS, FS_WIRE_SKY); this.land = program(VS_WIRE, FS_WIRE); },
  draw(F, out) {
    const cell = 1.6, camZ = F.travel * 5.5, row = Math.floor(camZ / cell), t = F.time;
    const eye = [Math.sin(t * 0.09) * 0.5, 1.85 + Math.sin(t * 0.13) * 0.1, 0];
    const c = camera(eye, [eye[0] * 0.4, eye[1] - 0.12, 10], 1.0, Math.sin(t * 0.07) * 0.015, 0.1, 500);
    const set = u => { F.set(u); setCam(u, c); gl.uniform1f(u.uCell, cell); gl.uniform1f(u.uSnap, camZ - row * cell); gl.uniform1f(u.uRow, row % 4096); };
    beginMS(); quad(this.sky, set);
    gl.enable(gl.DEPTH_TEST); mesh(this.land, grid(128), set); endMS(out);
  } });
}

// 32_basalt.js

// ───────────────────────── Basalt Ridge: a solid, wet volcanic canyon flown toward the last light ─────────────────────────
{
const BAS_FN = `
uniform float uCell; uniform vec2 uSnap;
const float RIVER = 3.4;
float bend(float zw){ return sin(zw*.031)*3.2+sin(zw*.013+2.)*2.6; }
float ridged(vec2 w){ vec3 q = vec3(w*.055, 0.); float n = 0., a = .5, k = 1.;
  for (int i = 0; i < 5; i++){ float v = 1.-abs(2.*noise(q)-1.); v *= v; n += a*v*k; k = clamp(v*1.7, .3, 1.); q = q*2.03+vec3(3.1,1.7,0.); a *= .5; }
  return n; }
float basH(vec2 w, float zl){                        // w: world xz (the rock is fixed to the world), zl: distance ahead
  float ax = abs(w.x-bend(w.y)), bank = smoothstep(RIVER, 15., ax), f = clamp((ax-RIVER)/72., 0., 1.);
  float far = 1.-smoothstep(178., 200., zl);
  float sw = hist(.03+f*.25, max(zl,0.)/190.);                              // each beat's swell runs away up the canyon
  return bank*far*(.2+ridged(w)*(7.+ax*.34)*((.42+1.25*specS(.015+f*.8))*(.55+.6*uDyn)+.08*uKick)+sw*sw*1.5);
}`;
const BAS_SKY = `
vec3 basSky(vec3 rd){
  float y = max(rd.y, 0.), az = atan(rd.x, rd.z);
  vec3 hor = neon(.08)*.85+neon(.0)*.15;                                         // the glow where the sun went down
  vec3 col = mix(hor*.07*(.6+.5*uBassS+.5*uKick)+vivid(.62)*.03, vec3(.003,.005,.014)+neon(.62)*.03, 1.-exp(-y*5.));
  col += hor*exp(-az*az*3.5)*exp(-y*13.)*(.4+.4*uBassS+1.2*uKick+.8*uDrop);
  vec2 cp = rd.xz/(rd.y+.12);                                                   // a cloud deck, lit from underneath
  float cl = smoothstep(.45,.8, fbm(vec3(cp.x*.4, cp.y*1.5+uTime*.012, 1.)))*exp(-y*2.4)*smoothstep(0.,.05,rd.y);
  col = mix(col, col*.3+hor*(.12+.2*uBassS+.34*uKick+.3*uDrop)*exp(-y*4.5)*exp(-az*az*1.2), cl*.75);
  col += neon(.62)*cl*uSnare*.07*noise(vec3(cp*.5, uTime*.3));                 // snares flicker in the cloud like far lightning
  col += stars(rd)*.6*smoothstep(.22,.5,rd.y)*(1.-cl);
  return col;
}`;
const VS_BAS = VSH + BAS_FN + `
out vec3 vW, vN; out float vDepth;
void main(){
  vec2 g = vec2(aUV.x*256.-128., aUV.y*256.-6.);
  float zl = g.y*uCell+uSnap.x, x = g.x*uCell, zw = g.y*uCell+uSnap.y, e = uCell*.5;
  float h = basH(vec2(x, zw), zl);
  vW = vec3(x, h, zl);
  vN = normalize(vec3(h-basH(vec2(x+e, zw), zl), e, h-basH(vec2(x, zw+e), zl+e)));
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_BAS_SKY = FSH + BAS_FN + BAS_SKY + `
out vec4 o; void main(){ o = vec4(basSky(viewRay()), 500.); }`;
const FS_BAS = FSH + BAS_FN + BAS_SKY + `
in vec3 vW, vN; in float vDepth; out vec4 o;
void main(){
  vec3 v = normalize(vW-uEye), n = normalize(vN); float dist = length(vW-uEye);
  vec2 w = vec2(vW.x, vW.z-uSnap.x+uSnap.y); float dxr = w.x-bend(w.y), ax = abs(dxr);                                   // world-locked, for detail that must not swim
  float f = clamp((ax-RIVER)/72., 0., 1.), s = spec(.015+f*.8), steep = 1.-n.y;
  vec3 lc = neon(.55+f*.3+vW.y*.02), hot = neon(.06)*.7+.3, col;
  float river = 1.-smoothstep(RIVER-.5, RIVER+.1, ax);
  // micro-relief on the rock, slow ripples on the water
  vec2 dp = w*mix(1.9, .7, river); float e = .12, t = uTime*.5*river, k = mix(1.1, .22, river)/(1.+dist*.05);
  vec2 gr = vec2(noise(vec3(dp+vec2(e,0.),t))-noise(vec3(dp-vec2(e,0.),t)), noise(vec3(dp+vec2(0.,e),t))-noise(vec3(dp-vec2(0.,e),t)));
  n = normalize(mix(n, vec3(0.,1.,0.), river)+vec3(gr.x,0.,gr.y)*k);
  vec3 r = reflect(v, n); r.y = abs(r.y)+.003; r = normalize(r);
  float c = max(dot(n,-v),0.), fr = pow(1.-c, 5.);
  float wet = mix(smoothstep(.35,.7, noise(vec3(w*.35, 5.))), 1., river);
  vec3 alb = mix(vec3(.02,.021,.027), vec3(.085,.082,.09), noise(vec3(w*.8, 2.))*noise(vec3(w*3.1, 7.))*1.6);
  vec3 sunL = normalize(vec3(0.,.1,1.));
  float lit = pow(clamp(dot(n, sunL)*.5+.5, 0., 1.), 6.);
  col = alb*((n.y*.5+.5)*(neon(.62)*.42+.01) + hot*lit*.5)*(1.-river);              // rock: cool sky fill, warm grazing light         // rock: cool sky fill, warm grazing light
  col += basSky(r)*mix((.01+.4*fr)*mix(.15, 1., wet), .1+.9*fr, river);            // wet stone and water mirror the horizon
  // glowing strata on the canyon walls; each kick sends a swell of light away along them
  float iso = vW.y*2.1, fwi = max(fwidth(iso), .01);
  float line = (1.-smoothstep(.3,1.3,abs(fract(iso-.5)-.5)/fwi))*(1.-smoothstep(.3,.9,fwi))*smoothstep(.12,.4,steep)*(1.-river);
  float sw = hist(.04+f*.3, dist/190.);
  col += lc*line*((.015+.5*s*s+2.6*sw*sw*sw)*exp(-dist*.03)+1.3*ring(dist, 80., 7., 2.)*exp(-dist*.012))*smoothstep(.3,.55,steep);
  col += hot*smoothstep(.8,1.,n.y)*smoothstep(2.6,6.5,vW.y)*(.15+2.4*s*s+.9*uKick+uDrop);  // the crests catch fire with their bands
  col += lc*exp(-abs(ax-RIVER+.3)*3.)*noise(vec3(w*.6, uTime*.2))*(.008+.04*uBass+.08*uKick)*exp(-dist*.03);   // a faint glow lapping the shore   // the shoreline
  float xw = wave(dist*.012)*(.15+.6*uLevelS);
  col += (hot*.6+lc*.4)*exp(-abs(dxr-xw)*(9.-dist*.03))*(.05+.35*uLevel)*exp(-dist*.03)*river*(.5+.5*noise(vec3(w.y*1.5, uTime, 0.)));   // the waveform, floating down the river
  float fog = 1.-exp(-dist*.0085); fog = mix(fog, 1., smoothstep(160., 198., dist));
  col = mix(col, basSky(normalize(vec3(v.x, .02+max(v.y,0.)*.3, v.z))), fog*fog*(3.-2.*fog));
  o = vec4(col, vDepth);
}`;
const bend = z => Math.sin(z * 0.031) * 3.2 + Math.sin(z * 0.013 + 2) * 2.6;
scene({ id: 'basalt', name: 'Basalt Ridge', from: 'Neon', kind: 'terrain', group: 'refined', pal: 3, hue: t => Math.sin(t * 0.04) * 0.05,
  about: 'A solid, rain-wet volcanic canyon flown toward the last light: ridges rise with their bands, strata glow, the river carries the waveform',
  inputs: ['specS', 'spec', 'hist', 'wave', 'bassS', 'levelS', 'bass', 'level', 'kick', 'snare', 'pulse', 'dyn', 'drop', 'travel'],
  cost: 'Moderate: 131k triangles with three five-octave height lookups a vertex, and the sky evaluated twice a pixel. Phones: a 160 grid and three octaves.',
  post: { bloom: 0.45, thr: 1.0, knee: 0.6, spread: 0.74, exp: 1.1, ca: 0.4, vig: 0.85 },
  init() { this.sky = program(VS, FS_BAS_SKY); this.land = program(VS_BAS, FS_BAS); },
  draw(F, out) {
    const cell = 0.8, camZ = F.travel * 6, snap = Math.floor(camZ / cell) * cell, t = F.time, zw = (snap % 65536) + camZ - snap;
    const eye = [bend(zw + 4) + Math.sin(t * 0.15) * 0.5, 2.6 + Math.sin(t * 0.23) * 0.35 + A.bassS * 0.3, 0];
    eye[1] += A.kick * 0.14;
    const c = camera(eye, [bend(zw + 26), eye[1] + 0.9 - A.kick * 0.5, 24], 1.0 - A.kick * 0.05 + A.dyn * 0.05, Math.sin(t * 0.1) * 0.035, 0.1, 600);
    const set = u => { F.set(u); setCam(u, c); gl.uniform1f(u.uCell, cell); gl.uniform2f(u.uSnap, snap - camZ, snap % 65536); };
    beginMS(); quad(this.sky, set);
    gl.enable(gl.DEPTH_TEST); mesh(this.land, grid(256), set); endMS(out);
  } });
}

// 33_contour.js
{
// Public-domain Natural Earth countries (1:110m) and populated places (1:50m).
const WORLD_RINGS = "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BggBAhEFBQENAwQLCQMACQIJDAEMBw4ABgoAEAUIAg4EigHgAaImnAcPBw0DAwcFBQ0ACQENAgkACwEJBwMABwMHBQsCCQAPCgkCAAoIAgQEAQYCCgAKCRABCgAIBQwABAcGAQwHDgEGBgUDDgYDBgUACAcMAQYDBAIKBAQCCAEIBgwCCwYKDgYIBgwGBgIGAQwGCgICBAQACAASBggGBAgKCAAIAggKDgYNCAIFCAYIBgMCDAgIBAgIAgAECAEABAgCCAIKBQoJCgAKAQMKCAwIBAMECAoKBggBDgIBCAkGCAIKAwgFDgMEAAoDCgQGAAQCCAcFBwUFAwECBQUHBQcCAwwHDgUIBQoHBgAIBQIDEAUKBgQIAggCCAYOAQgABAEIAgwEBAMGBAgECAAGBgYEBwIJBAEABwYHAgcBBQYLDAYEBwgFAQUEDQIHBAEEDQAHBAsSBwoHDAUBAwgJBhEIBAYFBAICEQwJCAUMCwQNAAcACQgNAQ0BBwMNAAcDCwUNCwcFDQUFAw0FBwMLAQsAAwkFEQANBwcFBwUNBgkEAggHAw0JDQQJAgcCDwQJCgMMAQgHBg8CBggDDAcLDQEICAIKBggBDAsNCQUFCwsGAAgJDAcGAgQTCgsADQgdARMFEQMPAIsBCtwgmAwBDwUDDQMHDAEYBhoMCQYJCBGMAQqYJMQNDQQADggIEgQIAAQFBQcDCQ0FjAHmAcQgxhABCAwEDRwgCAgCCh4gBQoIABAOAAwMBgAECQ4HFgUMDQURBgcSARYBFAkIAQgNCgkSACADFgIQARYJFAAIAxIIGgYYABIGDAgMBgMGAwYICggBEgMQChgGDAoKBBgCDAACBA0MCwYNBQ8CBwEDBgwQBgwUBRYKAAgOEAoGAAgJBA4IFAIWAhgFDgUKDwYFBAkGDxwDFAsGDxgADgYaBgcNBQUFEQkPEwQNBQQNARMHAAAHCQoFCRkFBAcNAAcGCwsPBw0LFQMLBxEDCggDBgwKBwoNBRELCQkPAAcHCAsOAQAFDgUSDA4FCgACCRUDBwcPBwcLEgcGDwoNCgsACwkFBAcKAwENBQsHAQsRCxMPExUNFQ0RAQkFBQQHBxUHEQEDDwkBAwwEBhUGBwMPBAUIAggPBAUGDQcPAQsACQMHAQITBwIBAgAICwUFBAsGBA4JAgMQDwMCFA4MAg4BDAUEBQoH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";
const CITIES = [["Tokyo",139.75,35.69],["Mexico City",-99.13,19.44],["Dhaka",90.41,23.73],["Buenos Aires",-58.4,-34.6],["Cairo",31.25,30.05],["Beijing",116.39,39.93],["Manila",120.98,14.61],["Moscow",37.61,55.75],["Paris",2.33,48.87],["Seoul",127.0,37.57],["Jakarta",106.83,-6.17],["London",-0.12,51.5],["Lima",-77.05,-12.05],["Tehran",51.42,35.67],["Kinshasa",15.31,-4.33],["Bogota",-74.09,4.6],["Taipei",121.57,25.04],["Bangkok",100.51,13.75],["Santiago",-70.67,-33.45],["Madrid",-3.69,40.4],["Singapore",103.85,1.29],["Luanda",13.23,-8.84],["Baghdad",44.39,33.34],["Khartoum",32.53,15.59],["Riyadh",46.77,24.64],["Hanoi",105.85,21.04],["Washington,  D.C.",-77.01,38.9],["Abidjan",-4.04,5.32],["Brasília",-47.92,-15.78],["Ankara",32.86,39.93],["Berlin",13.4,52.52],["Algiers",3.05,36.77],["Rome",12.48,41.9],["Pyongyang",125.75,39.02],["Kabul",69.18,34.52],["Athens",23.73,37.99],["Cape Town",18.43,-33.92],["Addis Ababa",38.7,9.04],["Nairobi",36.81,-1.28],["Caracas",-66.92,10.5],["Dar es Salaam",39.27,-6.8],["Lisbon",-9.15,38.72],["Kyiv",30.51,50.44],["Dakar",-17.48,14.72],["Damascus",36.3,33.5],["Tunis",10.18,36.8],["Vienna",16.36,48.2],["Tripoli",13.18,32.89],["Tashkent",69.29,41.31],["Havana",-82.37,23.13],["Santo Domingo",-69.9,18.47],["Baku",49.86,40.4],["Accra",-0.22,5.55],["Kuwait City",47.98,29.37],["Sanaa",44.2,15.36],["Port-au-Prince",-72.34,18.54],["Bucharest",26.1,44.44],["Asunción",-57.64,-25.29],["Beirut",35.51,33.87],["Minsk",27.56,53.9],["Brussels",4.33,50.84],["Warsaw",21.0,52.25],["Rabat",-6.84,34.03],["Quito",-78.5,-0.21],["Antananarivo",47.51,-18.91],["Budapest",19.08,47.5],["Yaoundé",11.51,3.87],["La Paz",-68.15,-16.5],["Abuja",7.53,9.09],["Harare",31.04,-17.82],["Montevideo",-56.17,-34.86],["Bamako",-8.0,12.65],["Conakry",-13.68,9.53],["Phnom Penh",104.91,11.55],["Lomé",1.22,6.13],["Doha",51.53,25.29],["Kuala Lumpur",101.7,3.17],["Maputo",32.59,-25.95],["San Salvador",-89.2,13.71],["Kampala",32.58,0.32],["Brazzaville",15.28,-4.26],["Pretoria",28.23,-25.7],["Lusaka",28.28,-15.41],["San José",-84.09,9.94],["Panama City",-79.53,8.97],["Stockholm",18.1,59.35],["Sofia",23.31,42.69],["Prague",14.46,50.09],["Ouagadougou",-1.53,12.37],["Ottawa",-75.7,45.42],["Helsinki",24.93,60.18],["Yerevan",44.51,40.18],["Mogadishu",45.36,2.07],["Tbilisi",44.79,41.73],["Belgrade",20.47,44.82],["Dushanbe",68.77,38.56],["København",12.56,55.68],["Amman",35.93,31.95],["Dublin",-6.25,53.34],["Monrovia",-10.8,6.31],["Amsterdam",4.91,52.35],["Jerusalem",35.21,31.78],["Guatemala City",-90.53,14.62],["N'Djamena",15.05,12.12],["Tegucigalpa",-87.22,14.1],["Kingston",-76.77,17.98],["Naypyidaw",96.12,19.77],["Djibouti",43.15,11.6],["Managua",-86.27,12.15],["Niamey",2.11,13.52],["Tirana",19.82,41.33],["Kathmandu",85.31,27.72],["Ulaanbaatar",106.91,47.92],["Kigali",30.06,-1.95],["Bishkek",74.58,42.88],["Oslo",10.75,59.92],["Bangui",18.56,4.37],["Freetown",-13.24,8.47],["Islamabad",73.16,33.7],["Cotonou",2.52,6.4],["Vientiane",102.6,17.97],["Riga",24.1,56.95],["Nouakchott",-15.98,18.09],["Muscat",58.59,23.61],["Ashgabat",58.38,37.95],["Zagreb",16.0,45.8],["Sarajevo",18.38,43.85],["Chișinău",28.86,47.01],["Lilongwe",33.78,-13.98],["Asmara",38.93,15.33],["Abu Dhabi",54.37,24.47],["Port Louis",57.5,-20.17],["Libreville",9.46,0.39],["Manama",50.58,26.24],["Vilnius",25.32,54.68],["Skopje",21.43,42.0],["Hargeisa",44.07,9.56],["Pristina",21.17,42.67],["Bloemfontein",26.23,-29.12],["Bratislava",17.12,48.15],["Bissau",-15.6,11.87],["Tallinn",24.73,59.43],["Wellington",174.78,-41.3],["Valletta",14.51,35.9],["Maseru",27.48,-29.32],["Nur-Sultan",71.43,51.18],["Bujumbura",29.36,-3.38],["Canberra",149.13,-35.28],["New Delhi",77.2,28.6],["Ljubljana",14.51,46.06],["Bandar Seri Begawan",114.93,4.88],["Port-of-Spain",-61.52,10.65],["Port Moresby",147.19,-9.46],["Bern",7.47,46.92],["Windhoek",17.08,-22.57],["Georgetown",-58.17,6.8],["Paramaribo",-55.17,5.84],["Dili",125.58,-8.56],["Nassau",-77.35,25.08],["Sucre",-65.26,-19.04],["Nicosia",33.37,35.17],["Colombo",79.86,6.93],["Gaborone",25.91,-24.65],["Yamoussoukro",-5.28,6.82],["Bridgetown",-59.62,13.1],["Suva",178.44,-18.13],["Reykjavík",-21.95,64.15],["Malabo",8.78,3.75],["Podgorica",19.27,42.47],["Moroni",43.24,-11.7],["Praia",-23.52,14.92],["Malé",73.5,4.17],["Luxembourg",6.13,49.61],["Thimphu",89.64,27.47],["Mbabane",31.13,-26.32],["São Tomé",6.73,0.33],["Honiara",159.95,-9.44],["Apia",-171.74,-13.84],["Andorra",1.52,42.5],["Hamilton",-64.78,32.29],["Kingstown",-61.21,13.15],["Port Vila",168.32,-17.73],["Banjul",-16.59,13.45],["Nuku'alofa",-175.22,-21.14],["Castries",-61.0,14.0],["Monaco",7.41,43.74],["Vaduz",9.52,47.13],["Saint John's",-61.85,17.12],["Saint George's",-61.74,12.05],["Victoria",55.45,-4.62],["San Marino",12.44,43.94],["Tarawa",173.02,1.34],["Majuro",171.38,7.1],["Roseau",-61.39,15.3],["Basseterre",-62.72,17.3],["Belmopan",-88.77,17.25],["Melekeok",134.63,7.49],["Funafuti",179.22,-8.52],["Palikir",158.15,6.92],["Vatican City",12.45,41.9],["New York",-73.98,40.75],["Mumbai",72.86,19.02],["São Paulo",-46.63,-23.56],["Delhi",77.23,28.67],["Shanghai",121.43,31.22],["Kolkata",88.32,22.5],["Los Angeles",-118.18,33.99],["Karachi",66.99,24.87],["Rio de Janeiro",-43.23,-22.92],["Ōsaka",135.46,34.75],["Istanbul",29.01,41.11],["Lagos",3.39,6.45],["Chicago",-87.75,41.83],["Guangzhou",113.32,23.15],["Shenzhen",114.12,22.55],["Wuhan",114.27,30.58],["Hong Kong",114.18,22.31],["Tianjin",117.2,39.13],["Chennai",80.28,13.09],["Bengaluru",77.56,12.97],["Lahore",74.35,31.56],["Chongqing",106.59,29.57],["Hyderabad",78.48,17.4],["Amaravati",80.52,16.53],["Miami",-80.23,25.79],["Belo Horizonte",-43.92,-19.91],["Philadelphia",-75.17,40.0],["Ahmedabad",72.58,23.03],["Ho Chi Minh City",106.69,10.78],["Toronto",-79.42,43.7],["Barcelona",2.18,41.39],["Dallas",-96.84,32.82],["Shenyeng",123.45,41.81],["Pune",73.85,18.53],["Sydney",151.18,-33.92],["St.  Petersburg",30.31,59.94],["Chattogram",91.8,22.33],["Dongguan",113.74,23.05],["Atlanta",-84.4,33.83],["Boston",-71.07,42.33],["Houston",-95.34,29.82],["Guadalajara",-103.33,20.67],["Melbourne",144.97,-37.82],["Alexandria",29.95,31.2],["Chengdu",104.07,30.67],["Detroit",-83.08,42.33],["Yangon",96.16,16.79],["Xian",108.89,34.28],["Porto Alegre",-51.2,-30.05],["Surat",72.84,21.2],["Monterrey",-100.33,25.67],["Nanjing",118.78,32.05],["Montréal",-73.59,45.5],["Guiyang",106.72,26.58],["Recife",-34.92,-8.07],["Harbin",126.65,45.75],["Fortaleza",-38.58,-3.75],["Ürümqi",87.57,43.81],["Phoenix",-112.07,33.54],["Salvador",-38.48,-12.97],["Busan",129.01,35.1],["San Francisco",-122.42,37.77],["Johannesburg",28.03,-26.17],["Medellín",-75.58,6.28],["Nagoya",136.91,35.16],["Changchun",125.34,43.87],["Casablanca",-7.62,33.6],["Dalian",121.63,38.92],["Kanpur",80.32,26.46],["Kano",8.52,12.0],["Tel Aviv",34.77,32.08],["Curitiba",-49.32,-25.42],["Seattle",-122.34,47.57],["Zibo",118.05,36.8],["Jeddah",39.22,21.52],["Hangzhou",120.17,30.25],["Milan",9.2,45.47],["Kunming",102.68,25.07],["Jaipur",75.81,26.92],["San Diego",-117.18,32.82],["Taiyuan",112.54,37.88],["Frankfurt",8.68,50.1],["Qingdao",120.33,36.09],["Surabaya",112.75,-7.25],["Jinan",116.99,36.68],["Fukuoka",130.41,33.6],["Campinas",-47.1,-22.9],["Kaohsiung",120.27,22.63],["Aleppo",37.17,36.23],["Durban",30.98,-29.86],["Lucknow",80.91,26.86],["Zhengzhou",113.66,34.76],["Taichung",120.68,24.15],["Ibadan",3.93,7.38],["Minneapolis",-93.25,44.98],["Fuzhou",119.3,26.08],["Changsha",112.97,28.2],["İzmir",27.15,38.44],["Lanzhou",103.79,36.06],["Incheon",126.64,37.48],["Sapporo",141.34,43.08],["Xiamen",118.08,24.45],["Guayaquil",-79.92,-2.22],["George Town",100.33,5.41],["San Juan",-66.13,18.44],["Mashhad",59.57,36.27],["Nagpur",79.09,21.17],["Jinxi",120.83,40.75],["Shijiazhuang",114.48,38.05],["Jilin",126.55,43.85],["Omdurman",32.48,15.62],["Bandung",107.57,-6.95],["Wenzhou",120.65,28.02],["Nanchang",115.88,28.68],["Tampa",-82.46,27.95],["Vancouver",-123.12,49.28],["Denver",-104.99,39.74],["Birmingham",-1.92,52.48],["Baltimore",-76.62,39.3],["Cali",-76.5,3.4],["Sendai",141.02,38.29],["Naples",14.24,40.84],["Manchester",-2.25,53.5],["St. Louis",-90.24,38.64],["Puebla",-98.2,19.05],["Nanchong",106.13,30.78],["Nanning",108.32,22.82],["Belém",-48.48,-1.45],["Patna",85.13,25.63],["Zaozhuang",117.57,34.88],["Yantai",121.4,37.53],["Medan",98.65,3.58],["Santa Cruz",-63.23,-17.75],["Xuzhou",117.18,34.28],["Linyi",118.33,35.08],["Maracaibo",-71.66,10.73],["Hiroshima",132.44,34.39],["Baotou",109.82,40.65],["Hefei",117.28,31.85],["Indore",75.86,22.72],["Goiânia",-49.3,-16.72],["Haiphong",106.68,20.83],["Suzhou",116.98,33.64],["Nanyang",112.53,33.0],["Ningbo",121.55,29.88],["Douala",9.71,4.06],["Cleveland",-81.7,41.47],["Portland",-122.68,45.52],["Brisbane",153.03,-27.45],["Pittsburgh",-80.0,40.43],["Las Vegas",-115.22,36.21],["Kyoto",135.75,35.03],["Barranquilla",-74.8,10.96],["Valencia",-67.98,10.23],["Hamburg",10.0,53.55],["Vadodara",73.18,22.31],["Manaus",-60.0,-3.1],["Wuxi",120.3,31.58],["Palembang",104.75,-2.98],["San Bernardino",-117.3,34.12],["Bhopal",77.41,23.25],["Hohhot",111.66,40.82],["Coimbatore",76.95,11.0],["Daqing",125.0,46.58],["San Jose",-121.85,37.3],["Turin",7.67,45.07],["Suzhou",120.62,31.3],["Ludhiana",75.87,30.93],["Qiqihar",123.99,47.35],["Anshan",122.94,41.12],["Cincinnati",-84.46,39.16],["Handan",114.48,36.58],["Isfahan",51.7,32.7],["Sacramento",-121.47,38.58],["Shantou",116.67,23.37],["Agra",78.01,27.17],["Zhanjiang",110.38,21.2],["Khulna",89.56,22.84],["Tijuana",-117.08,32.5],["Santiago",-70.67,19.5],["Perth",115.84,-31.95],["Vishakhapatnam",83.3,17.73],["Multan",71.45,30.2],["Kochi",76.22,10.02],["Gujranwala",74.18,32.16],["Florence",11.25,43.78],["Bursa",29.07,40.2],["León",-101.7,21.15],["Nasik",73.78,20.0],["San Antonio",-98.51,29.49],["Kansas City",-94.61,39.11],["Daejeon",127.42,36.34],["Neijiang",105.05,29.58],["Quanzhou",118.58,24.9],["Kharkiv",36.25,50.0],["Hyderabad",68.37,25.38],["Córdoba",-64.18,-31.4],["Huainan",116.98,32.63],["Kaduna",7.44,10.52],["Ft.  Worth",-97.34,32.74],["Gwangju",126.91,35.17],["Indianapolis",-86.17,39.75],["Lyon",4.83,45.77],["Tabriz",46.3,38.09],["The Hague",4.27,52.08],["Davao",125.63,7.11],["Marseille",5.37,43.29],["Meerut",77.7,29.0],["Mianyang",104.77,31.47],["Semarang",110.42,-6.96],["Faridabad",77.31,28.44],["Novosibirsk",82.96,55.03],["Milwaukee",-87.92,43.05],["Makkah",39.82,21.43],["Dubai",55.28,25.23],["Auckland",174.76,-36.85],["Lubumbashi",27.48,-11.68],["Varanasi",83.0,25.33],["Orlando",-81.38,28.51],["Ghaziabad",77.41,28.66],["Asansol",86.98,23.69],["Mosul",43.14,36.35],["Yekaterinburg",60.6,56.85],["Peshawar",71.53,34.01],["Mandalay",96.08,21.97],["Jamshedpur",86.2,22.79],["Mbuji-Mayi",23.6,-6.15],["Madurai",78.12,9.92],["Adana",35.32,37.0],["Jabalpur",79.95,23.18],["Nizhny Novgorod",44.0,56.33],["Chifeng",118.95,42.27],["Munich",11.57,48.13],["Huaiyin",119.03,33.58],["Makassar",119.43,-5.14],["Rajkot",70.8,22.31],["Dhanbad",86.42,23.8],["Shiraz",52.57,29.63],["Geneva",6.14,46.21],["Tianshui",105.92,34.6],["Liupanshui",104.83,26.6],["Seville",-5.98,37.41],["Amritsar",74.87,31.64],["Vila Velha",-40.32,-20.37],["Almaty",76.91,43.33],["Rosario",-60.67,-32.95],["Allahabad",81.84,25.46],["Benin City",5.62,6.34],["Maceió",-35.73,-9.62],["Banghazi",20.06,32.12],["Raleigh",-78.64,35.82],["Austin",-97.74,30.27],["Glasgow",-4.25,55.88],["Adelaide",138.6,-34.93],["Torreón",-103.42,25.57],["Srinagar",74.81,34.1],["Vijayawada",80.63,16.52],["Samara",50.15,53.2],["Omsk",73.4,54.99],["Yulin",110.15,22.63],["Kazan",49.12,55.75],["Aurangabad",75.32,19.9],["Calgary",-114.08,51.08],["Zürich",8.55,47.38],["Ankang",109.02,32.68],["Huambo",15.76,-12.75],["Bhilai",81.43,21.22],["Chelyabinsk",61.44,55.16],["Natal",-35.24,-5.78],["Memphis",-90.0,35.12],["Edmonton",-113.5,53.55],["Sholapur",75.9,17.67],["Rostov",39.71,47.24],["Dnipro",35.0,48.48],["Xining",101.77,36.62],["Norfolk",-76.28,36.85],["Lille",3.08,50.65],["Ranchi",85.33,23.37],["São Luís",-44.27,-2.51],["Florianópolis",-48.52,-27.58],["Port Elizabeth",25.6,-33.97],["Port Harcourt",7.01,4.81],["Jiamusi",130.35,46.83],["Bridgeport",-73.2,41.18],["Ufa",56.04,54.79],["Hengyang",112.59,26.88],["Buffalo",-78.88,42.88],["Medina",39.58,24.5],["Fez",-5.0,34.06],["Da Nang",108.25,16.06],["Baoshan",99.15,25.12],["Aden",45.01,12.78],["Perm",56.25,58.0],["Ahvaz",48.72,31.28],["Jodhpur",73.01,26.29],["San Luis Potosí",-101.0,22.17],["Odessa",30.71,46.49],["Yinchuan",106.27,38.47],["Jacksonville",-81.67,30.33],["Donetsk",37.83,48.0],["Guilin",110.28,25.28],["Volgograd",44.5,48.71],["Guwahati",91.77,26.16],["Chandigarh",76.78,30.72],["Gwalior",78.18,26.23],["Salt Lake City",-111.93,40.78],["Jixi",130.97,45.3],["Mérida",-89.62,20.97],["Pingxiang",113.85,27.62],["Thiruvananthapuram",76.95,8.5],["Kozhikode",75.77,11.25],["Ogbomosho",4.24,8.13],["Tiruchirappalli",78.69,10.81],["General Santos",125.17,6.11],["Tulsa",-95.93,36.12],["Krasnoyarsk",92.86,56.02],["Konya",32.47,37.88],["Richmond",-77.45,37.55],["Teresina",-42.78,-5.09],["Naha",127.67,26.21],["Honolulu",-157.86,21.31],["New Orleans",-90.04,30.0],["Anchorage",-149.9,61.22],["Hubballi",75.12,15.36],["Nashville",-86.78,36.17],["Raipur",81.63,21.24],["Palermo",13.35,38.13],["Cardiff",-3.23,51.5],["Tampico",-97.87,22.3],["Toulouse",1.45,43.62],["Bhubaneswar",85.83,20.27],["Thessaloniki",22.88,40.7],["Culiacán",-107.38,24.83],["Bordeaux",-0.6,44.85],["Oklahoma City",-97.52,35.47],["Trujillo",-79.02,-8.12],["Rochester",-77.62,43.17],["Taizz",44.04,13.61],["Kolhapur",74.22,16.7],["Shaoguan",113.58,24.8],["Acapulco",-99.92,16.85],["Catania",15.08,37.5],["Syracuse",-76.15,43.05],["Knoxville",-83.92,35.97],["Genoa",8.93,44.41],["Québec",-71.25,46.84],["Bur Said",32.29,31.26],["Nanded",77.3,19.17],["Dresden",13.75,51.05],["Luxor",32.65,25.7],["Nagano",138.17,36.65],["Cuttack",85.89,20.47],["Veracruz",-96.16,19.18],["Quetzaltenango",-91.52,14.83],["Macau",113.55,22.2],["Tabuk",36.55,28.38],["Matamoros",-97.5,25.88],["Matsuyama",132.77,33.85],["Rouen",1.08,49.43],["Oaxaca",-96.67,17.08],["Gold Coast",153.45,-28.08],["Suez",32.55,30.0],["Gaza City",34.45,31.53],["Edinburgh",-3.22,55.95],["Akola",77.01,20.71],["Bari",16.87,41.11],["Port Sudan",37.22,19.62],["Bologna",11.34,44.5],["Kalaburagi",76.82,17.35],["Tuxtla Gutiérrez",-93.15,16.75],["Iquitos",-73.25,-3.75],["Belfast",-5.96,54.6],["Wuzhou",111.32,23.48],["Strasbourg",7.75,48.58],["Nantes",-1.59,47.21],["Nagasaki",129.89,32.76],["Laredo",-99.51,27.51],["Baton Rouge",-91.14,30.46],["Asyut",31.18,27.19],["Gifu",136.76,35.42],["Huancayo",-75.2,-12.08],["Kassala",36.39,15.46],["Columbia",-80.9,34.04],["Chiang Mai",98.98,18.8],["Piura",-80.63,-5.21],["Al-Ubayyid",30.22,13.18],["Pasto",-77.28,1.21],["Des Moines",-93.62,41.58],["Mazatlán",-106.42,23.22],["Cusco",-71.97,-13.53],["Halifax",-63.6,44.65],["Chimbote",-78.57,-9.07],["Nuevo Laredo",-99.55,27.5],["Kōchi",133.54,33.56],["Nakhon Ratchasima",102.1,15.0],["Wonsan",127.43,39.16],["Montpellier",3.87,43.61],["Miyazaki",131.42,31.92],["El Faiyum",30.84,29.31],["Aswan",32.9,24.09],["Pucallpa",-74.53,-8.37],["Cagliari",9.1,39.22],["Cuenca",-79.0,-2.9],["Ica",-75.73,-14.07],["Corpus Christi",-97.4,27.74],["Venice",12.33,45.44],["Nancy",6.2,48.68],["Rio Branco",-67.8,-9.97],["Dire Dawa",41.86,9.59],["Jackson",-90.18,32.3],["Shreveport",-93.77,32.5],["Berbera",45.02,10.44],["Le Havre",0.1,49.5],["Clermont-Ferrand",3.08,45.78],["Novi Sad",19.85,45.25],["Colima",-103.72,19.23],["Banja Luka",17.18,44.78],["Tallahassee",-84.28,30.45],["Orléans",1.9,47.9],["Trieste",13.8,45.65],["Rennes",-1.67,48.1],["Bahir Dar",37.38,11.6],["Campeche",-90.5,19.83],["Montgomery",-86.28,32.36],["Reims",4.03,49.25],["Caen",-0.35,49.18],["Savannah",-81.11,32.02],["Sittwe",92.88,20.14],["Dijon",5.03,47.33],["Jayapura",140.7,-2.53],["Wilmington",-77.95,34.23],["Malakal",31.66,9.54],["Gondar",37.46,12.61],["Battambang",103.2,13.1],["Cairns",145.76,-16.89],["Limoges",1.25,45.83],["Perugia",12.39,43.11],["Amiens",2.3,49.9],["Townsville",146.77,-19.25],["Topeka",-95.67,39.05],["Papeete",-149.57,-17.53],["St. John's",-52.68,47.58],["Lae",146.99,-6.73],["Besançon",6.03,47.23],["Charleston",-81.63,38.35],["David",-82.43,8.43],["Siem Reap",103.85,13.37],["Trento",11.12,46.08],["Assab",42.73,13.01],["Ancona",13.5,43.6],["Sakata",139.85,38.92],["Mekele",39.47,13.5],["Catanzaro",16.6,38.9],["Burlington",-73.21,44.48],["Nouméa",166.44,-22.26],["Poitier",0.33,46.58],["Limón",-83.03,10.0],["Sault Ste. Marie",-84.35,46.5],["Potenza",15.8,40.64],["L'Aquila",13.39,42.35],["Rockhampton",150.52,-23.36],["Mt.  Hagen",144.22,-5.86],["Cruzeiro do Sul",-72.67,-7.63],["Ajaccio",8.73,41.93],["Campobasso",14.66,41.56],["North Bay",-79.45,46.3],["Charlottetown",-63.13,46.25],["Goroka",145.39,-6.08],["Sydney",-60.18,46.07],["Douglas",-4.48,54.15],["Aosta",7.32,45.74],["Mount Isa",139.49,-20.72],["Dongola",30.48,19.17],["Ramallah",35.21,31.9],["Augusta",-69.78,44.31],["Armidale",151.67,-30.51],["Santa Cruz",-90.35,-0.53],["Windorah",142.65,-25.43]];
// Scan-convert the packed rings once. One filtered texel supplies land, boundary and province tint.

const HYDROGRAPHY="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";
function atlasReader(data){
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = new Uint8Array(data.length * 3 / 4);
  let acc = 0, bits = 0, count = 0;
  for (const ch of data) {
    const v = alphabet.indexOf(ch); if (v < 0) break;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; bytes[count++] = acc >> bits; }
  }
  let cursor = 0;
  function uint() {
    let n = 0, shift = 0, b;
    do { b = bytes[cursor++]; n += (b & 127) << shift; shift += 7; } while (b & 128);
    return n;
  }
  function delta() { const n = uint(); return (n >>> 1) ^ -(n & 1); }
  return {uint,delta,remaining:()=>cursor<count};
}
// The source stores each river path once as delta-coded lon/lat at 1/400 degree.
// Bin its segments once at load. Native builds run this factory ahead of playback.
function hydroTexture() {
  const r = atlasReader(HYDROGRAPHY), cells = new Map();
  const width = 720, height = 360, units = 200;
  let records = 0;

  // Clip to a cell plus a margin. The global coordinate grid keeps the two copies
  // of a shared boundary segment aligned, even though the shader reads one cell.
  function addSegment(x0,y0,x1,y1, sides) {
    const bleed=sides ? 36 : 18;
    const dx=x1-x0, dy=y1-y0;
    if (Math.abs(dx)>72000 || (dx===0 && dy===0)) return;
    const left=Math.max(0,Math.floor((Math.min(x0,x1)-bleed)/units));
    const right=Math.min(width-1,Math.floor((Math.max(x0,x1)+bleed)/units));
    const low=Math.max(0,Math.floor((Math.min(y0,y1)-bleed)/units));
    const high=Math.min(height-1,Math.floor((Math.max(y0,y1)+bleed)/units));
    for (let y=low;y<=high;y++) for (let x=left;x<=right;x++) {
      const a=x0-x*units, b=y0-y*units;
      let lo=0, hi=1;
      if (dx) {
        const t0=(-bleed-a)/dx, t1=(units+bleed-a)/dx;
        lo=Math.max(lo,Math.min(t0,t1)); hi=Math.min(hi,Math.max(t0,t1));
      }
      if (dy) {
        const t0=(-bleed-b)/dy, t1=(units+bleed-b)/dy;
        lo=Math.max(lo,Math.min(t0,t1)); hi=Math.min(hi,Math.max(t0,t1));
      }
      if (lo>=hi) continue;
      const factor=sides ? .5 : 1, offset=sides ? 32 : 22;
      const ax=Math.round((a+lo*dx)*factor)+offset, ay=Math.round((b+lo*dy)*factor)+offset;
      const bx=Math.round((a+hi*dx)*factor)+offset, by=Math.round((b+hi*dy)*factor)+offset;
      if (ax===bx && ay===by) continue;
      const cell=y*width+x;
      let batch=cells.get(cell);
      if (!batch) { batch={rivers:[],edges:[]}; cells.set(cell,batch); }
      if (sides) {
        if (!batch.edges.length) records++;
        batch.edges.push(ax,ay,bx,by,sides[0],sides[1],0,0); records+=2;
      } else { batch.rivers.push(ax,ay,bx,by); records++; }
    }
  }
  while (r.remaining()) {
    const n=r.uint();
    let x=r.delta(), y=r.delta();
    for (let i=1;i<n;i++) {
      const nextX=x+r.delta(), nextY=y+r.delta();
      addSegment(x,y,nextX,nextY); x=nextX; y=nextY;
    }
  }
  // Pair adjacent rings so a political border is drawn once. Ring winding gives
  // the country on each side, including the shoreline around polygon holes.
  const rings = atlasReader(WORLD_RINGS), edges = new Map();
  let outerId = 0;
  while (rings.remaining()) {
    const country = rings.uint(), n = rings.uint(), points = [];
    let x=0, y=0, area=0;
    if (country) outerId=country;
    for (let i=0;i<n;i++) {
      const a=x,b=y; x+=rings.delta(); y+=rings.delta();
      points.push([x,y]); if (i) area+=a*y-x*b;
    }
    const insideLeft = country ? area>0 : area<0;
    for (let i=1;i<n;i++) {
      let [a,b]=points[i-1], [c,d]=points[i];
      if (a===c && b===d) continue;
      const forward=a<c || (a===c && b<d);
      if (!forward) { [a,c]=[c,a]; [b,d]=[d,b]; }
      const key=[a,b,c,d].join(',');
      let edge=edges.get(key);
      if (!edge) { edge={a,b,c,d,sides:[0,0]}; edges.set(key,edge); }
      edge.sides[insideLeft===forward ? 0 : 1]=outerId;
    }
  }
  for (const e of edges.values())
    addSegment(e.a*50,e.b*50,e.c*50,e.d*50,e.sides);
  let address=width*height;
  const rows=Math.ceil((address+records)/width), pixels=new Uint8Array(width*rows*4);
  for (const [cell,batch] of cells) {
    const i=cell*4, n=batch.rivers.length/4, count=batch.edges.length/8;
    if (n>31 || count>48) throw new Error('Map detail cell exceeds shader segment capacity');
    pixels[i]=address&255; pixels[i+1]=(address>>>8)&255; pixels[i+2]=address>>>16; pixels[i+3]=n+(count ? 32 : 0);
    pixels.set(batch.rivers,address*4); address+=n;
    if (count) {
      pixels[address*4]=count; address++;
      pixels.set(batch.edges,address*4); address+=2*count;
    }
  }
  const tex=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,rows,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  return tex;
}

function worldMapTexture() {
  const width = 2880, height = 1440;
  const {uint,delta,remaining}=atlasReader(WORLD_RINGS);
  const ids = new Uint8Array(width * height);
  while (remaining()) {
    const country = uint(), vertices = uint(), rows = new Map();
    let x = 0, y = 0;
    for (let k = 0; k < vertices; k++) {
      const a = x, b = y; x += delta(); y += delta();
      if (!k) continue;
      for (let row = Math.min(y,b); row < Math.max(y,b); row++) {
        if (!rows.has(row)) rows.set(row, []);
        rows.get(row).push(a + (row+.5-b)*(x-a)/(y-b));
      }
    }
    for (const [row, edges] of rows) {
      edges.sort((a,b)=>a-b);
      for (let k = 0; k+1 < edges.length; k += 2)
        ids.fill(country, row*width+Math.ceil(edges[k]-.5), row*width+Math.ceil(edges[k+1]-.5));
    }
  }
  // Upload the compact ID field directly. The shader compares neighbours for the borders.
  const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,width,height,0,gl.RED,gl.UNSIGNED_BYTE,ids);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  return t;
}
const CITY_ROWS=Math.ceil(CITIES.length/10);
const FS_MAP = FSH + `
out vec4 o; uniform sampler2D uMap,uText,uHydro; uniform vec2 uCentre,uHeading; uniform float uSpan;
uniform float uWidths[14]; uniform vec4 uPlaces[14]; // centre-relative lon/lat, atlas index, selection opacity
// Packed grid headers contain the bounded vector list for this half-degree cell.
vec4 mapRecord(int addr) {
  return floor(texelFetch(uHydro, ivec2(addr % 720, addr / 720), 0)*255.+.5);
}
float segmentDistance2(vec2 a,vec2 b,vec2 pos,vec2 px){
  vec2 from=(a-pos)*px, dir=(b-a)*px;
  vec2 d=from+dir*clamp(-dot(from,dir)/max(dot(dir,dir),.000001),0.,1.);
  return dot(d,d);
}
float cross2(vec2 a,vec2 b){return a.x*b.y-a.y*b.x;}
float mapDetails(vec2 uv,vec2 scale,inout float id,out float coast,out float border){
  vec2 grid=vec2(fract(uv.x)*720.,clamp(uv.y,0.,.999999)*360.);
  ivec2 cell=ivec2(floor(grid));
  ivec4 h=ivec4(mapRecord(cell.y*720+cell.x));
  int offset=h.x+256*h.y+65536*h.z, rivers=h.w%32;
  vec2 local=fract(grid)*.5, px=uRes.y/scale;
  float river2=1024., coast2=1024., border2=1024.;
  for(int i=0;i<31;i++){
    if(i>=rivers) break;
    vec4 e=(mapRecord(offset+i)-22.)/400.;
    river2=min(river2,segmentDistance2(e.xy,e.zw,local,px));
  }
  if(h.w>=32){
    offset+=rivers;
    int count=int(mapRecord(offset).x); offset++;
    // Trace from the sampled country-ID texel centre to this fragment. Crossing
    // the true line updates land coverage to subpixel accuracy at close zoom.
    vec2 ref=(floor(local*8.)+.5)/8., stepDir=local-ref;
    float closest=-1., nearest=.085*.085, nearestId=-1.;
    for(int i=0;i<48;i++){
      if(i>=count) break;
      vec4 e=(mapRecord(offset+2*i)-32.)/200.;
      vec2 sides=mapRecord(offset+2*i+1).rg, dir=e.zw-e.xy;
      float d2=segmentDistance2(e.xy,e.zw,local,px);
      if(min(sides.x,sides.y)<.5) coast2=min(coast2,d2);
      else border2=min(border2,d2);
      // A country-grid texel centred exactly on a diagonal has ambiguous parity.
      // For a point projecting onto a nearby edge, its signed side is definitive.
      float along=dot(local-e.xy,dir)/max(dot(dir,dir),.00000001);
      vec2 d=local-e.xy-dir*clamp(along,0.,1.);
      float geographicD2=dot(d,d);
      if (geographicD2<nearest) {
        nearest=geographicD2;
        nearestId=(along>0. && along<1.) ? (cross2(dir,local-e.xy)>0. ? sides.x : sides.y) : -1.;
      }
      float den=cross2(stepDir,dir);
      if(abs(den)<.0000001) continue;
      float t=cross2(e.xy-ref,dir)/den, u=cross2(e.xy-ref,stepDir)/den;
      if(t>closest && t>=0. && t<=1. && u>=0. && u<=1.){
        closest=t; id=cross2(dir,local-e.xy)>0. ? sides.x : sides.y;
      }
    }
    if(nearestId>=0.) id=nearestId;
  }
  coast=sqrt(coast2); border=sqrt(border2);
  return sqrt(river2);
}

void main(){
  vec2 q=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  float latitudeScale=max(.45,cos(radians(uCentre.y)));
  vec2 scale=vec2(uSpan/latitudeScale,uSpan);
  vec2 rel=q*scale, m=rel+uCentre, uv=(m+vec2(180.,90.))/vec2(360.,180.);
  float id=texture(uMap,uv).r*255., shorePx, borderPx;
  float lineDist=mapDetails(uv,scale,id,shorePx,borderPx);
  float land=mix(.5,step(.5,id),smoothstep(0.,.85,shorePx));
  float coast=1.-smoothstep(.40,1.45,shorePx);
  float border=1.-smoothstep(.35,1.25,borderPx);
  // Engraved relief and ocean graticule; the coastlines and political borders above use real geometry.
  float h=fbm(vec3(m*.28,4.)),iso=h*12.;
  float contours=(1.-smoothstep(.3,1.35,abs(fract(iso)-.5)/max(fwidth(iso),.0001)))*land;
  float minorIso = h*60.;
  float minorContours = 1.-smoothstep(.30,1.00,abs(fract(minorIso)-.5)/max(fwidth(minorIso),.0001));
  vec2 grid=abs(fract(m/10.+.5)-.5)*10./max(fwidth(m),vec2(.001));
  float graticule=1.-smoothstep(.25,1.25,min(grid.x,grid.y));
  float grain=noise(vec3(m*vec2(27.,68.),3.));
  vec3 sea=vec3(.10,.235,.255)*(.86+.20*h);
  vec3 earth=mix(vec3(.48,.345,.19),vec3(.66,.56,.325),.4*h+.6*fract(id*.618));
  vec3 col=mix(sea,earth,land)*(.88+.20*grain);
  float slope=clamp((dFdy(h)-dFdx(h))/max(fwidth(h),.001),-1.,1.);
  col*=1.-.17*graticule-.26*contours-.095*land*minorContours+land*slope*.065;
  vec2 fold=abs(fract(m/vec2(21.,17.)+.5)-.5)*vec2(21.,17.);
  col*=1.-.12*exp(-min(fold.x,fold.y)*7.);
  col*=.90+.13*fbm(vec3(m*.08,8.));
  col=mix(col,vec3(.12,.078,.045),clamp(border,0.,.76));

  float voice = spec(fract(m.y*.036+m.x*.014));
  float stroke = max(.80, uRes.y / 720.)*(1.04 + .18*voice);
  float bank = 1.-smoothstep(stroke+.15,stroke+1.2,lineDist);
  float river = 1.-smoothstep(max(0.,stroke-.55),stroke+.55,lineDist);
  col = mix(col,vec3(.80,.72,.51),bank*.67);
  col = mix(col,vec3(.025,.160,.215)+vec3(.025,.19,.21)*voice,river*.94);
  vec2 minorGrid=abs(fract(m/2.+.5)-.5)*2./max(fwidth(m),vec2(.001));
  col*=1.-.065*(1.-smoothstep(.2,1.2,min(minorGrid.x,minorGrid.y)));
  float d=length(q), survey=ring(d*38.,7.,.8,1.9);
  col+=vec3(.12,.65,.69)*coast*(.26+1.8*uKickL+survey);
  col+=vec3(.98,.41,.12)*border*survey*.93+neon(.35+h*.4)*contours*spec(h)*.29;
  for(int i=0;i<14;i++){
    vec4 city=uPlaces[i]; if(city.w<.01) continue;
    vec2 off=q-city.xy/scale;
    float r=length(off), band=spec(.14+.69*fract(city.z*.618));
    bool major = city.z < 523.;
    float px = 1./uRes.y;
    float dotRadius = major ? .0032 : .00225;
    float dotInk = 1.-smoothstep(dotRadius-px*.55,dotRadius+px*.55,r);
    float rim = 1.-smoothstep(dotRadius+px*.3,dotRadius+px*1.4,r);
    col=mix(col,vec3(.91,.80,.57),rim*city.w);
    col=mix(col,major?vec3(.27,.097,.030):vec3(.285,.145,.068),dotInk*city.w);
    float ringRadius = dotRadius+.002+.008*uKickL;
    float ringLine = 1.-smoothstep(.0004,.0004+px,abs(r-ringRadius));
    col+=city.w*(vec3(.28,.59,.54)*ringLine*uKickL+vec3(.35,.22,.08)*dotInk*band);
    vec2 labelSize=major ? vec2(.19,.034) : vec2(.163,.027);
    float width=uWidths[i]*labelSize.x, gap=dotRadius+.0015;
    bool alignLeft=city.x/scale.x+gap+width>uRes.x/uRes.y*.5-.008;
    vec2 anchor=vec2(alignLeft ? -width-gap : gap,-labelSize.y*.5);
    vec2 glyph=(off-anchor)/labelSize;
    if(all(greaterThanEqual(glyph,vec2(0.))) && all(lessThan(glyph,vec2(1.)))){
      vec2 cell=vec2(mod(city.z,10.),${CITY_ROWS-1}.-floor(city.z/10.));
      float ink=texture(uText,(glyph+cell)/vec2(10.,${CITY_ROWS}.)).r;
      col=mix(col,mix(vec3(.94,.85,.61),major?vec3(.070,.035,.019):vec3(.135,.077,.035),land),ink*city.w);
    }
  }
  vec2 heading=normalize(uHeading/scale+vec2(.00001,0.));
  float forward=dot(q,heading), crossTrack=dot(q,vec2(-heading.y,heading.x));
  float track=(1.-smoothstep(.0007,.0022,abs(crossTrack)))*smoothstep(-.24,-.05,forward)*(1.-smoothstep(-.01,0.,forward));
  col=mix(col,vec3(.46,.085,.035),track*smoothstep(.2,.55,fract(forward*93.))*.83);
  float nib=1.-smoothstep(.0005,.0025,max(abs(crossTrack)-(.009-forward)*.45,max(forward-.012,-forward-.008)));
  col=mix(col,vec3(1.1,.54,.11),nib);
  col+=vec3(.75,.25,.065)*exp(-abs(d-.018-.021*uKickL)*440.)*uKickL;
  col*=1.-.30*min(1.,dot(q,q));
  o=vec4(col,1.);
}`;
const TOUR=[[2,48],[14,43],[31,31],[40,7],[73,20],[106,16],[132,35],[143,-27],[285,-12],[260,22],[279,43],[338,60],[362,48]];
scene({id:'contour',name:'Neon Cartography',from:'Neon',kind:'field',group:'refined',pal:5,
  about:'A traveling atlas of real borders and cities. Bass lights the coasts and sends a survey pulse across borders; pitched notes pick out individual cities.',
  inputs:['spec','kickL','pulse','travel'],post:{bloom:.38,thr:.83,grain:.035,vig:.4},
  init(){this.p=program(VS,FS_MAP);this.map=worldMapTexture();this.hydro=hydroTexture();this.text=textAtlas(CITIES.map(c=>c[0]),10,176,28,'italic 600 20px Georgia, serif');this.places=new Float32Array(56);this.labelWidths=new Float32Array(14);
    this.widths=CITIES.map(([name])=>Math.min(1,(8+name.length*15)/176));this.opacity=new Map();},
  draw(F,out){
    const progress=Math.max(0,F.travel)*.005, i=Math.floor(progress)%(TOUR.length-1), f=progress%1, ease=f*f*(3-2*f);
    const start=TOUR[i],end=TOUR[i+1],cx=start[0]+(end[0]-start[0])*ease,cy=start[1]+(end[1]-start[1])*ease;
    const span=3.5+2*Math.sin(Math.PI*f)**2, lat=Math.max(.45,Math.cos(cy*Math.PI/180)), aspect=T.sw/T.sh;
    const near=[];
    for(let n=0;n<CITIES.length;n++){
      const [,lon,y]=CITIES[n],dx=((lon-cx+900)%360)-180,dy=y-cy,x=dx*lat/span;
      if(Math.abs(x)>aspect*.5-.010||Math.abs(dy)>span*.48) continue;
      if(near.some(c=>Math.abs((c.dx-dx)*lat/span)<.18 && Math.abs((c.dy-dy)/span)<.040)) continue;
      near.push({n,dx,dy}); if(near.length===14) break;
    }
    this.places.fill(0);
    const shown=new Map();
    near.forEach(({n,dx,dy},k)=>{const opacity=Math.min(1,(this.opacity.get(n)||0)+F.dt*3);shown.set(n,opacity);this.labelWidths[k]=this.widths[n];this.places.set([dx,dy,n,opacity],k*4);});
    this.opacity=shown;
    draw(this.p,out,T.sw,T.sh,u=>{F.set(u);bindTex(3,this.map);gl.uniform1i(u.uMap,3);bindTex(5,this.hydro);gl.uniform1i(u.uHydro,5);bindTex(4,this.text.t);gl.uniform1i(u.uText,4);gl.uniform2f(u.uCentre,cx,cy);gl.uniform1f(u.uSpan,span);gl.uniform2f(u.uHeading,end[0]-start[0],end[1]-start[1]);gl.uniform1fv(u.uWidths,this.labelWidths);gl.uniform4fv(u.uPlaces,this.places);});
  }});
}

// 34_sea.js

// ───────────────────────── Mercury Tide: open ocean to the horizon under a low sun ─────────────────────────
{
// The surface is a grid projected from the camera onto the water plane, so it always reaches the horizon and
// spends its vertices evenly on screen. Seven trochoidal swells move it; six finer wind waves shade it.
const SEA_FN = `
const vec3 WV[7] = vec3[7](vec3(.05,61.,0.), vec3(-.32,37.,1.7), vec3(.41,23.,4.1), vec3(-.12,14.3,2.3), vec3(.63,8.9,5.2), vec3(-.55,5.7,.9), vec3(.22,3.6,3.3));
// displacement of the point at rest p; nrm takes the surface normal; px is the size of a pixel on the water,
// so waves too fine to draw are left out of the shading instead of shimmering
vec3 swell(vec2 p, float S, float px, out vec3 nrm){
  vec3 d = vec3(0.), n = vec3(0.,1.,0.); float warp = noise(vec3(p*.013, uTime*.03))*5.;
  for (int i = 0; i < 7; i++){
    float lam = WV[i].y, k = TAU/lam, w = sqrt(9.8*k)*.8; vec2 D = vec2(sin(WV[i].x), -cos(WV[i].x));     // they come toward you
    float grp = .55+.9*noise(vec3(p*(.9/lam)+WV[i].z*7., uTime*.04+WV[i].z));                          // waves travel in groups
    float a = pow(lam, .72)*.021*S*grp, ph = k*dot(D,p)-w*uTime+WV[i].z+warp*(.3+.1*float(i)), c = cos(ph), s = sin(ph);
    float keep = 1.-smoothstep(.2,.5,px/lam);
    d += vec3(D.x*.55*a*c, a*s, D.y*.55*a*c);
    n += vec3(-D.x*k*a*c, -.55*k*a*s, -D.y*k*a*c)*keep;
  }
  nrm = n; return d; }`;
const SEA_SKY = `
const vec3 SUN = vec3(0., .0747, .9972);
vec3 sunCol(){ return mix(vec3(1.,.6,.3), neon(.1), .25); }
vec3 tint(vec3 c, float t){ return mix(c, neon(t)*dot(c, vec3(.4)), .22); }      // natural colours, leaning a little toward the palette
vec3 seaSky(vec3 rd, float lod){                       // lod 0: no clouds or stars (for reflections and haze)
  float y = max(rd.y, 0.), sa = clamp(dot(rd, SUN), 0., 1.), a = acos(sa);
  vec3 sc = sunCol();
  vec3 zen = tint(vec3(.012,.022,.075), .62), hi = tint(vec3(.1,.085,.26), .7), mid = tint(vec3(.5,.17,.25), .85), hor = tint(vec3(.95,.4,.13), .05);
  vec3 col = mix(hor, mid, smoothstep(0.,.11,y)); col = mix(col, hi, smoothstep(.05,.24,y)); col = mix(col, zen, smoothstep(.2,.6,y));
  col *= mix(.35, 1., exp(-a*1.6))*(.48+.3*uDyn+.15*uBassS+.22*uKick);                                 // warm toward the sun, cooler away from it
  col += sc*(exp(-a*22.)*.9+exp(-a*5.)*.12*(.7+.7*uBassS))*(1.+.7*uKick+.6*uDrop);
  col += sc*smoothstep(.034,.029,a)*30.*lod;
  // spokes of light from the sun: each angle is a band
  vec2 sp = vec2(rd.x, rd.y-SUN.y); float ang = atan(sp.y, abs(sp.x))/PI+.5, ray = spec(.03+ang*.7);
  col += sc*ray*ray*(.45+.55*noise(vec3(ang*38., uTime*.15, 1.)))*exp(-a*5.)*smoothstep(.03,.2,a)*.1*(1.+uDrop);
  float pulse = ring(a, .55, .1, 1.7);                                           // each kick: a ring of light crosses the sky from the sun
  col += sc*pulse*.06;
  if (lod > .5 && rd.y > 0.){
    vec2 cp = rd.xz/(rd.y+.09); vec2 sunP = vec2(0., 1.);
    // a low bank of cloud, lit from behind and below
    vec2 ca = vec2(cp.x*.33+uTime*.006, cp.y*.6);
    float d1 = fbm(vec3(ca, uTime*.012)), d2 = fbm(vec3(ca+sunP*.35, uTime*.012));
    float den = smoothstep(.48,.76,d1), shade = exp(-2.6*smoothstep(.45,.8,d2));
    vec3 lit = mix(tint(vec3(.06,.05,.12), .7), tint(vec3(1.,.42,.26), .02), shade*exp(-a*.8))*(.45+.7*uBassS+.5*uKick+1.6*pulse);
    lit += sc*pow(sa, 6.)*den*(1.-den)*3.*(.8+uKick);                             // silver linings toward the sun
    col = mix(col, lit, den*exp(-y*2.6)*smoothstep(0.,.035,rd.y)*.9);
    // high, thin streaks that catch the last colour
    float cir = smoothstep(.45,.95, fbm(vec3(cp.x*.11+d1*.6, cp.y*.5, 7.+uTime*.008)));
    col += tint(vec3(1.,.4,.45), .9)*cir*.14*exp(-y*1.1)*smoothstep(.04,.2,rd.y)*(.6+.7*uMid+2.5*pulse);
    col += stars(rd)*smoothstep(.3,.65,rd.y)*(.4+1.6*uHigh)*(1.-den);
  }
  return col;
}`;
const VS_SEA = VSH + SEA_FN + `
out vec3 vW; out vec2 vP; out float vS, vDepth;
void main(){
  float x = (aUV.x*2.-1.)*1.5;
  float yh = -(uCamF.y+uCamR.y*x*uTan*uAspect)/(uCamU.y*uTan);                    // where the horizon crosses this column
  float y = mix(-1.9, yh-.003, pow(aUV.y, .8));
  vec3 rd = uCamF+uCamR*(x*uTan*uAspect)+uCamU*(y*uTan);
  float t = min(-uEye.y/min(rd.y, -1e-4), 6000.); vec2 p = uEye.xz+rd.xz*t; float dist = t*length(rd);
  float hs = hist(.04, dist/320.);                                               // each beat's set of bigger waves rolls out to sea
  float S = (.4+.95*uBassS+.4*uDyn+.3*uKick)*(.7+1.4*hs*hs);
  vec3 nn; vec3 d = swell(p, S, 0., nn)*(1.-smoothstep(2500., 5500., dist));
  vW = vec3(p.x, 0., p.y)+d; vP = p; vS = S;
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_SEA_SKY = FSH + SEA_SKY + `
out vec4 o; void main(){ o = vec4(seaSky(viewRay(), 1.), 900.); }`;
const FS_SEA = FSH + SEA_FN + SEA_SKY + `
in vec3 vW; in vec2 vP; in float vS, vDepth; out vec4 o;
void main(){
  vec3 v = normalize(vW-uEye); float dist = length(vW-uEye);
  float px = dist*uTan*2./uRes.y/max(-v.y, .03);
  vec3 nrm; swell(vP, vS, px, nrm);
  // wind ripples: three layers of drifting noise, laid on the moving surface itself so they neither stretch nor repeat
  vec2 wp = vW.xz; float chop = .5+1.3*uHighS, near = 1.-smoothstep(4., 60., dist); vec2 g = vec2(0.); float fm = 0.;
  for (int i = 0; i < 3; i++){ float fi = float(i), sc2 = .55*pow(2.6, fi), e = .12/sc2, keep = 1.-smoothstep(.15,.45,px*sc2*2.);
    vec3 q = vec3(wp*sc2+vec2(fi*7.3, -uTime*(.5+.35*fi)), uTime*(.25+.2*fi)+fi*3.);
    float n0 = noise(q), nx = noise(q+vec3(e*sc2,0.,0.)), nz = noise(q+vec3(0.,e*sc2,0.));
    g += vec2(nx-n0, nz-n0)/e*(.05/sqrt(sc2))*chop*keep; fm += n0*keep/(1.+fi); }
  nrm.xz -= g; vec3 n = normalize(nrm);
  vec3 r = reflect(v, n); r.y = abs(r.y)+.002; r = normalize(r);
  float c = max(dot(n,-v),0.), fr = .02+.98*pow(1.-c, 5.);
  vec3 sc = sunCol(), refl = seaSky(r, 0.);
  float hn = clamp(vW.y/(vS*1.4)+.5, 0., 1.);
  float toSun = pow(max(dot(normalize(v.xz), normalize(SUN.xz)), 0.), 4.);
  vec3 body = tint(vec3(.006,.026,.045), .6);
  body += tint(vec3(.05,.42,.38), .5)*hn*hn*hn*toSun*.22*(.7+.6*uBassS);     // light through the backs of the waves
  // foam: torn streaks that gather on the steep fronts of the bigger waves, only close by
  float hn2 = clamp(vW.y/(vS*1.1)+.35, 0., 1.), steep = smoothstep(.12, .4, length(nrm.xz)/nrm.y);
  float foam = smoothstep(.62, .95, hn2*steep*1.25+(noise(vec3(wp*vec2(2.1, 6.3)+vec2(0., uTime*.5), 1.))-.5)*.5+(fm-.9)*.2)*near*(.3+.7*uBassS);    // thin lace on the steepest fronts
  vec3 col = mix(body, refl, fr);
  col = mix(col, tint(vec3(.5,.52,.6), .7)*(.6+.8*dot(seaSky(vec3(0.,1.,0.), 0.), vec3(.6)))+sunCol()*.2, foam*.3);
  float sd = max(dot(r, SUN), 0.), rough = smoothstep(0., 700., dist);            // the far sea glitters broadly, the near sea sharply
  col += sc*(pow(sd, mix(900., 70., rough))*mix(26., 2.2, rough)+pow(sd, 14.)*.07)*(.7+.6*uKick+.4*uDrop)*fr*2.;
    float fog = 1.-exp(-dist*.0011);
  col = mix(col, seaSky(normalize(vec3(v.x, .004, v.z)), 0.), fog*fog);
  o = vec4(col, vDepth);
}`;
scene({ id: 'sea', name: 'Mercury Tide', from: 'Fable', kind: 'terrain', group: 'refined', pal: 3, hue: t => 0.02 * Math.sin(t * 0.05),
  about: 'Open ocean to the horizon under a low sun: the bass raises the swell, each beat sends a set of bigger waves out to sea, and the sky answers',
  inputs: ['hist', 'spec', 'bassS', 'highS', 'mid', 'high', 'kick', 'pulse', 'dyn', 'drop'],
  cost: 'Moderate: seven swells, nine noise lookups for ripples and foam, and two cheap sky lookups a pixel; the sky itself is four fbm lookups. Phones: four swells, three wind waves, no cloud self-shadow.',
  post: { bloom: 0.5, thr: 1.1, knee: 0.6, spread: 0.72, exp: 1.0, ca: 0.4, vig: 0.8, pulse: 0.2 },
  init() { this.sky = program(VS, FS_SEA_SKY); this.surf = program(VS_SEA, FS_SEA); },
  draw(F, out) {
    const t = F.time;
    const eye = [Math.sin(t * 0.04) * 0.6, 3.6 + Math.sin(t * 0.06) * 0.12, 0];                 // a steady camera: the sea moves, the view does not
    const c = camera(eye, [Math.sin(t * 0.03) * 0.8, eye[1] - 4.6, 60], 0.95, Math.sin(t * 0.035) * 0.008, 0.5, 9000);
    const set = u => { F.set(u); setCam(u, c); };
    beginMS(); quad(this.sky, set);
    gl.enable(gl.DEPTH_TEST); mesh(this.surf, grid(256), set); endMS(out);
  } });
}

// 36_hex.js

// ───────────────────────── Basalt Organ: a field of hexagonal columns; a drifting map decides which band each one plays ─────────────────────────
{
const HEX_NX = 84, HEX_NZ = 96;
const FS_HEX_SIM = VSP + `
out vec4 o;
void main(){ vec2 ij = floor(gl_FragCoord.xy);
  vec2 c = vec2(ij.x-${HEX_NX / 2}.+.5*mod(ij.y,2.), (ij.y-${HEX_NZ / 2}.)*.8660254);
  float n = fbm(vec3(c*.05, uTime*.04)), band = clamp(n*1.9-.45, 0., 1.), s = specS(.02+band*.8);
  float r = length(c), rip = hist(.03, r/44.);
  float val = s*(.22+.78*s*s) + rip*rip*rip*.4*exp(-r*.03), sf = spec(.02+band*.8);
  o = vec4(val, band, r, sf*(.22+.78*sf*sf) + rip*rip*rip*.4*exp(-r*.03)); }`;
const VS_HEX = VSP + `
uniform sampler2D uCols;
out vec3 vW, vN; out vec4 vI; out float vAO, vTop, vDepth, vF;
const float RAD = .5774*.93;
vec2 corner(int k){ float a = (float(k)*60.+30.)*PI/180.; return vec2(cos(a), sin(a))*RAD; }
float colH(vec4 t){ return .3+t.x*8.; }
void main(){
  ivec2 ij = ivec2(gl_InstanceID % ${HEX_NX}, gl_InstanceID / ${HEX_NX});
  vec4 t = texelFetch(uCols, ij, 0); float H = colH(t);
  vec2 c = vec2(float(ij.x)-${HEX_NX / 2}.+.5*float(ij.y & 1), (float(ij.y)-${HEX_NZ / 2}.)*.8660254);
  // how much taller the six neighbours stand: that is the shade on this column's cap
  int o1 = (ij.y & 1) == 0 ? -1 : 0; float occ = 0.;
  ivec2 nb[6] = ivec2[6](ivec2(-1,0), ivec2(1,0), ivec2(o1,-1), ivec2(o1+1,-1), ivec2(o1,1), ivec2(o1+1,1));
  for (int k = 0; k < 6; k++){ ivec2 q = clamp(ij+nb[k], ivec2(0), ivec2(${HEX_NX - 1}, ${HEX_NZ - 1})); occ += max(colH(texelFetch(uCols, q, 0))-H, 0.); }
  int v = gl_VertexID; vec3 p; float edge, top;
  if (v < 18){ int tri = v/3, w = v%3; vec2 q = w == 0 ? vec2(0.) : corner(tri+w-1);
    p = vec3(q.x, H, q.y); vN = vec3(0.,1.,0.); edge = w == 0 ? 1. : 0.; top = 1.; }
  else { int qd = (v-18)/6, w = (v-18)%6; bool isB = (w == 1 || w == 3 || w == 4), isT = (w == 0 || w == 1 || w == 3);
    vec2 a = corner(qd), b = corner(qd+1), q = isB ? b : a;
    p = vec3(q.x, isT ? H : -4., q.y); vec2 nn = normalize(a+b); vN = vec3(nn.x, 0., nn.y); edge = isB ? 1. : 0.; top = 0.; }
  vW = p+vec3(c.x, 0., c.y); vI = vec4(edge, t.x, t.y, top); vAO = 1./(1.+occ*.55); vTop = H; vF = t.w;
  gl_Position = t.z > 41. ? vec4(2.,2.,2.,1.) : uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const HEX_FOG = `vec3 hexFog(vec3 rd){ return vec3(.003,.0035,.008) + (vivid(.62)*.5+vec3(.2,.25,.5))*.035*exp(-abs(rd.y)*7.)*(.5+uBass+.5*uKick); }`;
const FS_HEX = FSH + HEX_FOG + `
in vec3 vW, vN; in vec4 vI; in float vAO, vTop, vDepth, vF; out vec4 o;
void main(){
  vec3 n = normalize(vN), v = normalize(uEye-vW), L = normalize(vec3(-.45,.75,.35));
  float val = vI.y; vec3 lc = neon(.45+vI.z*.6+val*.2), col;
  float lit = mix(val, vF, .7);                                         // light leads, height follows
  float fr = pow(1.-max(dot(n,v),0.), 4.);
  float v2 = lit*lit, v3 = v2*lit;
  if (vI.w > .5){
    float rim = 1.-smoothstep(.0,.085,vI.x), inner = smoothstep(.0,.9,vI.x);
    col = vec3(.05,.052,.064)*(.1+.9*max(dot(n,L),0.))*vAO + vivid(.62)*fr*.2*vAO;           // polished stone
    col += pow(max(dot(reflect(-L,n),v),0.), 80.)*.7*vAO;
    col += (vivid(.62)*.5+.5)*pow(max(dot(reflect(-v,n), normalize(vec3(.3,.5,-.8))),0.), 18.)*.35*vAO;   // a sheen that sweeps the caps
    col += (lc*rim*(.04+v2*5.) + (lc*.8+.2)*v3*(.7+1.6*inner))*(1.+.45*uKick);                                    // lit edge, glowing cap
  } else {
    float below = vTop-vW.y, e = min(vI.x, 1.-vI.x);
    col = vec3(.02,.021,.027)*(.08+.5*max(dot(n,L),0.))*exp(-below*.8) + vivid(.62)*fr*.015*exp(-below*.5);
    col += lc*exp(-below*(2.8-1.3*val))*v3*1.3;                                                 // light running down the shaft
    col += lc*(1.-smoothstep(0.,.045,e))*exp(-below*1.4)*(.015+v2*.7);
  }
  float dist = length(vW-uEye);
  col = mix(col, hexFog(-v), 1.-exp(-max(dist-22.,0.)*.035));
  o = vec4(col, vDepth);
}`;
const FS_HEX_BG = FSH + HEX_FOG + `
out vec4 o; void main(){ o = vec4(hexFog(viewRay()), 140.); }`;

scene({ id: 'hex', name: 'Basalt Organ', from: 'Fable', kind: 'terrain', group: 'refined', pal: 0,
  about: 'A field of hexagonal columns; a drifting map decides which band each one plays, and kicks ripple out from the middle',
  inputs: ['specS', 'spec', 'hist', 'bass', 'kick'],
  cost: 'Moderate: 8k instanced prisms plus depth of field. Phones: no depth of field.',
  post: { dof: { ap: 9, max: 7 }, bloom: 0.45, thr: 1.0, knee: 0.6, ca: 0.4, vig: 0.9 },
  init() { this.sim = program(VS, FS_HEX_SIM); this.cols = program(VS_HEX, FS_HEX); this.bg = program(VS, FS_HEX_BG);
    this.state = target(HEX_NX, HEX_NZ, HDR ? gl.RGBA16F : gl.RGBA8, gl.NEAREST); },
  draw(F, out) {
    draw(this.sim, this.state, HEX_NX, HEX_NZ, F.set);
    const t = F.time, a = t * 0.05, R = 37, tgt = [0, 1.8, 0];
    const eye = [Math.sin(a) * R, 14 + Math.sin(t * 0.08) * 3.5, Math.cos(a) * R];
    const c = camera(eye, tgt, 0.56, 0, 0.5, 300); F.focus = Math.hypot(...sub(eye, tgt)) * 0.95;
    const set = u => { F.set(u); setCam(u, c); bindTex(3, this.state.t); gl.uniform1i(u.uCols, 3); };
    beginMS(); quad(this.bg, set);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(this.cols.p); set(this.cols.u); gl.drawArraysInstanced(gl.TRIANGLES, 0, 54, HEX_NX * HEX_NZ);
    endMS(out);
  } });
}

// 41_geo.js

// ───────────────────────── Geodesic World: a dome of triangular plates lifting off a lit core ─────────────────────────
{
// A real geodesic sphere: an icosahedron with every face split into FREQ² triangles. Each triangle is one
// instance (a little prism: a top plate and three walls) that lifts along its own normal with its band.
const GEO_FREQ = 9;
function geoTris(f) {
  const t = (1 + Math.sqrt(5)) / 2;
  const V = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(norm);
  const F = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  const out = [];
  for (const [ia, ib, ic] of F) {
    const a = V[ia], b = V[ib], c = V[ic];
    const P = (i, j) => norm([0, 1, 2].map(k => a[k] + (b[k] - a[k]) * i / f + (c[k] - a[k]) * j / f));
    for (let i = 0; i < f; i++) for (let j = 0; j < f - i; j++) {
      out.push(...P(i, j), ...P(i + 1, j), ...P(i, j + 1), out.length / 10);
      if (i + j < f - 1) out.push(...P(i + 1, j), ...P(i + 1, j + 1), ...P(i, j + 1), out.length / 10);
    }
  }
  return new Float32Array(out);
}
const VS_GEO = VSP + `
layout(location=1) in vec3 aA; layout(location=2) in vec3 aB; layout(location=3) in vec3 aC; layout(location=4) in float aId;
uniform vec3 uPole;
out vec3 vW, vN, vB; out float vBand, vDepth, vWave; flat out float vWall;
void main(){
  vec3 cen = normalize(aA+aB+aC);
  float band = clamp(fbm(cen*1.5+vec3(0.,uTravel*.06,uTime*.02))*2.-.5, 0., 1.);     // continents of bands; they drift faster when the music is fuller
  float s = specS(.02+band*.8);
  float wv = ring(acos(clamp(dot(cen, uPole),-1.,1.)), 1.9, .3, 1.7);               // each kick: a wave crosses the world from a wandering pole
  float lift = .015+s*s*.34*(.55+.75*uDyn)+wv*.17+uKick*.05*hashu(uint(aId)); vWave = wv;
  vec3 P[3] = vec3[3](aA, aB, aC); int v = gl_VertexID; vec3 d; float top = 1.;
  if (v < 3){ d = P[v]; vN = cen; vB = vec3(v == 0, v == 1, v == 2); vWall = 0.; }
  else { int q = (v-3)/6, w = (v-3)%6, c0 = q, c1 = (q+1)%3;
    bool second = (w == 1 || w == 3 || w == 4), isTop = (w == 0 || w == 1 || w == 3);
    d = second ? P[c1] : P[c0]; top = isTop ? 1. : 0.;
    vec3 nn = normalize(cross(P[c1]-P[c0], cen)); if (dot(nn, (P[c0]+P[c1])*.5-cen) < 0.) nn = -nn;
    vN = nn; vB = vec3(second ? 1. : 0., 0., top); vWall = 1.; }
  d = normalize(mix(cen, d, .9));                                                    // a gap between plates lets the core show
  vW = d*(top > .5 ? 1.+lift : .93)*(1.+.03*uBassS); vBand = band;
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_GEO = FSH + `
in vec3 vW, vN, vB; in float vBand, vDepth, vWave; flat in float vWall; out vec4 o;
void main(){
  vec3 n = normalize(vN), v = normalize(uEye-vW); float s = spec(.02+vBand*.8);
  vec3 lc = neon(.5+vBand*.5+vWave*.3), col; lc *= 1.+1.2*vWave+.5*uDrop;
  if (vWall < .5){
    float e = min(vB.x, min(vB.y, vB.z)), fe = max(fwidth(e), 1e-4);
    float line = 1.-smoothstep(.8,2.,e/fe), glow = exp(-e*13.);
    float fr = pow(1.-max(dot(n,v),0.), 3.); vec3 r = reflect(-v, n);
    col = vec3(.012,.014,.028) + lc*.02 + vivid(.62)*fr*.22;                         // dark glass plates
    col += (vivid(.62)*.4+.6)*pow(max(dot(r, normalize(vec3(-.5,.7,.5))),0.), 12.)*.7;   // whole facets flash as the world turns
    col += neon(.0)*pow(max(dot(r, normalize(vec3(.8,-.1,.4))),0.), 14.)*.25*(.4+uMidS);
    col += lc*(line*(.3+2.3*s*s)+glow*(.03+.42*s*s));
  } else {
    float edge = min(vB.x, 1.-vB.x);
    col = lc*exp(-vB.z*3.2)*(.12+.9*s*s)*(.5+uBass+.9*uKick) + lc*(1.-smoothstep(0.,.04,edge))*.2*vB.z;   // walls: lit from the core
  }
  o = vec4(col, vDepth);
}`;
const VS_GEO_CORE = VSH + `out vec3 vD; void main(){ vD = octDir(aUV); gl_Position = uVP*vec4(vD*.925, 1.); }`;
const FS_GEO_CORE = FSH + `
in vec3 vD; out vec4 o;
void main(){ vec3 d = normalize(vD); float f = fbm(d*4.+vec3(0.,uTime*.2,0.));
  o = vec4((neon(.08)*.6+neon(.92)*.4)*(.3+.9*f)*(.5+1.5*uBass+2.2*uKick+uDrop), 6.); }`;
const VS_GEO_RING = VSH + `
uniform mat3 uTilt; out vec2 vP;
void main(){ float a = aUV.x*TAU, r = mix(1.72, 2.72, aUV.y); vP = aUV; gl_Position = uVP*vec4(uTilt*vec3(cos(a)*r, 0., sin(a)*r), 1.); }`;
const FS_GEO_RING = FSH + `
in vec2 vP; out vec4 o;
void main(){
  const float NT = 240.; float u = vP.x, v = vP.y, cell = floor(u*NT), fu = fract(u*NT), band = abs((cell+.5)/NT*2.-1.);
  float sS = specS(.02+band*.82), s = spec(.02+band*.82), fwu = max(fwidth(u*NT), 1e-4), fwv = max(fwidth(v), 1e-4);
  float tick = (1.-smoothstep(.2,.2+fwu, abs(fu-.5)))*(1.-smoothstep(.35,1.,fwu));
  float len = .1+.72*sS*sS;                                                          // each tick is a band, mirrored round the ring
  float body = tick*smoothstep(.1-fwv, .1+fwv, v)*(1.-smoothstep(.1+len-fwv, .1+len+fwv, v));
  float rails = (1.-smoothstep(.5,1.8,abs(v-.07)/fwv)) + (1.-smoothstep(.5,1.8,abs(v-.93)/fwv))*.5;
  float wv = .5+wave(abs(u*2.-1.)*.5)*(.08+.25*uLevelS), trace = 1.-smoothstep(.6,2.,abs(v-wv)/fwv);
  vec3 lc = neon(.5+band*.5);
  o = vec4(lc*body*(.1+1.5*s*s) + vivid(.62)*rails*(.2+.25*uKick) + (lc*.4+.6)*trace*(.1+.6*uLevel), 1.);
}`;
const FS_GEO_BG = FSH + `
out vec4 o;
void main(){ vec3 rd = viewRay(); vec3 col = vec3(.002,.0022,.006) + vivid(.62)*.014*fbm(rd*2.2+4.) + neon(.0)*.006*fbm(rd*1.4-3.);
  col += stars(rd)*.8;
  float tca = -dot(uEye, rd), b = length(cross(uEye, rd));
  if (tca > 0.) col += neon(.5)*exp(-max(b-1.2,0.)*4.5)*(.05+.1*uBassS+.1*uKick);     // air on the limb
  o = vec4(col, 80.); }`;
scene({ id: 'geo', name: 'Geodesic World', from: 'Neon', kind: 'sphere', group: 'refined', pal: 4, hue: (t, travel) => t * 0.012 + travel * 0.02,
  about: 'A geodesic dome of 1,620 glass triangles lifting off a lit core in drifting continents of bands, ringed by a spectrum dial',
  inputs: ['specS', 'spec', 'wave', 'bassS', 'midS', 'levelS', 'bass', 'level', 'kick', 'pulse', 'dyn', 'drop', 'travel'],
  cost: 'Cheap: 1,620 instanced prisms (34k vertices), a small core sphere and one ring quad-strip.',
  post: { bloom: 0.42, thr: 0.9, knee: 0.6, ca: 0.5 },
  init() {
    this.bg = program(VS, FS_GEO_BG); this.plates = program(VS_GEO, FS_GEO); this.core = program(VS_GEO_CORE, FS_GEO_CORE); this.ring = program(VS_GEO_RING, FS_GEO_RING);
    const data = geoTris(GEO_FREQ); this.n = data.length / 10;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    [[1, 3, 0], [2, 3, 12], [3, 3, 24], [4, 1, 36]].forEach(([loc, size, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 40, off); gl.vertexAttribDivisor(loc, 1); });
    gl.bindVertexArray(vao);
    const a = 0.42, b = -0.22, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    this.tilt = [cb, sb, 0, -sb * ca, cb * ca, sa, sb * sa, -cb * sa, ca];           // Rx(a) · Rz(b), column-major
  },
  draw(F, out) {
    const t = F.time, c = camera(orbit(t * 0.05 + F.travel * 0.022, 0.24 + Math.sin(t * 0.06) * 0.14, 6.4 - A.bassS * 0.14 - A.kick * 0.22), [0, -0.05, 0], 0.74, 0, 0.1, 60);
    const pole = norm([Math.sin(t * 0.23), Math.sin(t * 0.17) * 0.8, Math.cos(t * 0.19)]);
    const set = u => { F.set(u); setCam(u, c); gl.uniform3fv(u.uPole, pole); };
    beginMS(); quad(this.bg, set);
    gl.enable(gl.DEPTH_TEST); mesh(this.core, grid(48), set);
    gl.useProgram(this.plates.p); set(this.plates.u); gl.bindVertexArray(this.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 21, this.n); gl.bindVertexArray(vao);
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    mesh(this.ring, grid(128), u => { set(u); gl.uniformMatrix3fv(u.uTilt, false, this.tilt); });
    endMS(out);
  } });
}

// 42_pool.js

// ───────────────────────── Ferrofluid: a pool of black liquid seen from above, pulled into fields of spikes ─────────────────────────
{
// Three magnets wander under the dish, one each for bass, mids and highs; where their pull passes a threshold
// the flat liquid breaks into a hexagonal lattice of spikes (as the real fluid does), and below it into
// meandering channels. Every kick sends a ring of spikes running outward.
const POOL_FN = `
uniform vec3 uMag[3];                       // x, z and strength of each magnet
const float SP = .36;
vec2 hexC(vec2 p, out vec2 id){             // offset to the nearest centre of a hexagonal lattice, and that centre
  const vec2 s = vec2(1., 1.7320508);
  vec2 a = (floor(p/s)+.5)*s, b = (floor((p-s*.5)/s)+.5)*s+s*.5, da = p-a, db = p-b;
  if (dot(da,da) < dot(db,db)){ id = a; return da; } id = b; return db; }
float field(vec2 c){
  float f = 0.;
  for (int i = 0; i < 3; i++){ vec2 d = c-uMag[i].xy; f += uMag[i].z*exp(-dot(d,d)*.75); }
  float r = length(c);
  f += specS(.03+r*.1)*.3*exp(-r*.22);                    // rings of the spectrum, bass in the middle
  f += ring(r, 3.4, .6, 2.1)*.8;                          // every kick: a ring of spikes runs outward
  return min(f*(.5+.6*uDyn), 1.3); }
vec2 poolH(vec2 p){                                       // height, and the pull there
  vec2 q = p+.44*(vec2(noise(vec3(p*.33, uTime*.06)), noise(vec3(p*.33+9.1, uTime*.06)))-.5);   // the lattice is alive: it drifts and shears
  vec2 id; vec2 d = hexC(q/SP, id); float x = sqrt(dot(d,d)+.003)/.5, A = field(id*SP);
  float on = smoothstep(.34, .95, A), tip = max(1.-x, 0.);
  float h = on*(.15+.85*A*A)*.5*tip*tip;
  float lab = sin((q.x*.8+q.y*.6)*9.+noise(vec3(q*1.2, uTime*.1))*9.);
  h += smoothstep(.06,.3,A)*(1.-on)*.05*(.5+.5*lab);                                            // channels, where the pull is weak
  h += .05*sin(p.x*.9+uTime*.7)*sin(p.y*.8-uTime*.5)*(.4+uBassS);
  return vec2(h, A); }`;
const VS_POOL = VSH + POOL_FN + `
out vec3 vW, vN; out float vDepth, vA;
void main(){
  vec2 p = (aUV*2.-1.)*vec2(6.4, 5.4)+vec2(0., .6); const float e = .03;
  vec2 h = poolH(p); float hx = poolH(p+vec2(e,0.)).x, hz = poolH(p+vec2(0.,e)).x;
  vW = vec3(p.x, h.x, p.y); vN = normalize(vec3(h.x-hx, e, h.x-hz)); vA = h.y;
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_POOL = FSH + `
in vec3 vW, vN; in float vDepth, vA; out vec4 o;
float softbox(vec3 r, vec3 ld, vec3 tx, vec2 size, float soft){ float c = dot(r, ld); if (c <= 0.) return 0.;
  vec3 ty = cross(ld, tx); vec2 q = abs(vec2(dot(r,tx), dot(r,ty))/c); vec2 a = smoothstep(size+soft, size-soft, q); return a.x*a.y; }
vec3 studio(vec3 r){
  vec3 cA = neon(.62), cB = neon(.12);
  vec3 col = vec3(.01,.012,.02)*(.4+.6*r.y);
  col += mix(cA, cB, smoothstep(-.7,.7,r.x))*exp(-max(r.y,0.)*3.5)*.22*(.4+uBassS+uKick);                       // the far wall, washed in two colours
  col += softbox(r, normalize(vec3(-.25,.9,.35)), vec3(.9,.1,.4), vec2(.34,.2), .2)*vec3(1.,.97,.93)*(1.1+1.6*uKick);   // key, overhead
  col += softbox(r, normalize(vec3(.93,.3,.2)), vec3(0.,1.,0.), vec2(1.1,.07), .03)*(cB*.8+.2)*10.*(.3+1.7*uMid);     // strip, right
  col += softbox(r, normalize(vec3(-.93,.28,-.1)), vec3(0.,1.,0.), vec2(1.2,.09), .04)*(cA*.85+.15)*10.*(.3+1.8*uBass); // strip, left
  float a = acos(clamp(dot(r, normalize(vec3(.1,.75,-.65))),-1.,1.));
  col += exp(-abs(a-.3)*70.)*vec3(1.4)*(.4+2.*uHigh);                                                           // ring light
  return col; }
void main(){
  vec3 n = normalize(vN), v = normalize(vW-uEye), r = reflect(v, n);
  float c = max(dot(n,-v),0.), fr = .055+.945*pow(1.-c, 5.), hn = clamp(vW.y/.55, 0., 1.);
  float ao = mix(1., mix(.25, 1., smoothstep(0.,.4,hn)), smoothstep(.34,.8,vA));     // the valleys between spikes are shadowed
  vec3 col = studio(r)*fr*ao + vec3(.003,.004,.007)*ao;
  col += neon(.1+vA*.4)*pow(hn, 5.)*(.25+.7*uKick+.9*uKickL);                        // the tallest tips run hot
  float rr = length((vW.xz-vec2(0.,.6))/vec2(1.18,1.));
  col *= 1.-smoothstep(3.9, 5.3, rr);                                                // the dish falls away into the dark
  o = vec4(col, vDepth);
}`;
scene({ id: 'pool', name: 'Ferrofluid', from: 'Fable', kind: 'field', group: 'refined', pal: 0,
  about: 'A pool of black liquid from above: three wandering magnets (bass, mids, highs) pull it into fields of spikes and channels, and every kick sends a ring of spikes outward',
  inputs: ['specS', 'bassS', 'midS', 'highS', 'bass', 'mid', 'high', 'kick', 'kickL', 'pulse', 'dyn'],
  cost: 'Vertex-heavy: 295k triangles with three height lookups a vertex, plus depth of field. Phones: the 192 grid, no depth of field.',
  post: { dof: { ap: 8, max: 7 }, bloom: 0.45, thr: 1.0, knee: 0.7, spread: 0.72, exp: 1.15, ca: 0.4, vig: 0.9 },
  init() { this.body = program(VS_POOL, FS_POOL); this.mag = new Float32Array(9); },
  draw(F, out) {
    const t = F.time, m = this.mag, tgt = [0, 0.1, 0.5];
    m.set([Math.sin(t * 0.23) * 2.3, Math.cos(t * 0.19) * 1.7 + 0.6, 0.25 + A.bassS * 1.5,
           Math.sin(t * 0.31 + 2.1) * 2.9, Math.cos(t * 0.27 + 1.3) * 2.1 + 0.6, 0.15 + A.midS * 1.6,
           Math.sin(t * 0.41 + 4.2) * 3.1, Math.cos(t * 0.37 + 3.7) * 2.3 + 0.6, 0.1 + A.highS * 1.8]);
    const eye = [Math.sin(t * 0.05) * 1.6, 6.3 - A.kick * 0.18, -4.9];
    const c = camera(eye, tgt, 0.62, Math.sin(t * 0.04) * 0.06, 0.2, 80); F.focus = Math.hypot(...sub(eye, tgt)) * 0.98;
    beginMS(); gl.enable(gl.DEPTH_TEST);
    mesh(this.body, grid(384), u => { F.set(u); setCam(u, c); gl.uniform3fv(u.uMag, m); });
    endMS(out);
  } });
}

// 45_solaris.js

// ───────────────────────── Solaris Relic: a broken shell of obsidian plates standing off a small star ─────────────────────────
{
// The plates are Voronoi cells baked once into an octahedral texture (edge distance, cell id). The shell is
// drawn as a stack of five thin layers; the cracks are cut out with alpha-to-coverage, so you look straight
// through them at the star and at the lit inside of the far wall.
const SOL_BAKE = HEAD + LIB + `
in vec2 uv; out vec4 o;
void main(){ vec3 d = octDir(uv); vec3 c = cells(d*2.5+.3*vec3(noise(d*2.6), noise(d*2.6+5.3), noise(d*2.6+9.1))); o = vec4(c.y-c.x, c.z, c.x, 1.); }`;
const SOL_FN = `
uniform sampler2D uCells; uniform float uLayer;
const float THICK = .1;
vec2 plate(vec3 d){ vec2 q = octUV(d); return vec2(textureLod(uCells, q, 0.).r, texelFetch(uCells, ivec2(clamp(q, 0., .9999)*1024.), 0).g); }
float crackW(){ return .05+.035*uBassS+.03*uKick; }
float liftOf(float id){ float s = specS(.02+id*.78); return .04+.46*s*s+.1*uKick; }`;
const VS_SOL = VSH + SOL_FN + `
out vec3 vW, vD; out float vDepth, vId;
void main(){
  vec3 d = octDir(aUV); vec2 pl = plate(d);
  vD = d; vId = pl.y; vW = d*(1.+liftOf(pl.y)-uLayer*THICK);
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_SOL = FSH + SOL_FN + `
in vec3 vW, vD; in float vDepth, vId; out vec4 o;
void main(){
  vec3 d = normalize(vD); vec2 pl = plate(d); float edge = pl.x, id = pl.y, w = crackW();
  float fe = max(fwidth(edge), 1e-4), cover = smoothstep(w-fe, w+fe, edge);
  if (cover < .02) discard;
  float s = spec(.02+id*.78), rim = exp(-(edge-w)*34.);
  vec3 fire = neon(.08)*.7+.3, deep = neon(.0);
  vec3 col;
  if (uLayer < .01){
    // the outer face: polished obsidian, bevelled toward its edges, catching a cool key light and the star's glow at the rim
    vec3 n = d, v = normalize(uEye-vW);
    vec3 px = dFdx(vW), py = dFdy(vW); float hb = smoothstep(w, w+.14, edge), hx = dFdx(hb), hy = dFdy(hb);
    vec3 r1 = cross(py, n), r2 = cross(n, px); float det = dot(px, r1);
    n = normalize(n*abs(det)-.07*sign(det)*(hx*r1+hy*r2));
    vec3 L = normalize(vec3(-.55,.5,.67)); float ndl = max(dot(n,L),0.), fr = pow(1.-max(dot(n,v),0.), 3.);
    float grain = noise(d*38.)*noise(d*90.);
    col = vec3(.012,.012,.016)*(.4+2.2*ndl)*(.6+1.2*grain) + vivid(.62)*(pow(max(dot(reflect(-L,n),v),0.), 30.)*.5*ndl+fr*.07);
    col += mix(deep, fire, rim)*rim*(.06+.9*s*s+.5*uKick);                        // the edges glow with the plate's band
  } else {
    // the layers underneath make the plate's sides and its underside, lit hot by the star
    col = mix(deep, fire, uLayer*uLayer)*(.03+.3*uLayer*uLayer)*(.35+1.6*s*s+.8*uBass+.9*uKick)*(.5+.5*rim);
  }
  o = vec4(col, cover);
}`;
const VS_SOL_STAR = VSH + `out vec3 vD; void main(){ vD = octDir(aUV); gl_Position = uVP*vec4(vD*(.56+.03*uBassS+.03*uKick), 1.); }`;
const FS_SOL_STAR = FSH + `
in vec3 vD; out vec4 o;
void main(){ vec3 d = normalize(vD), v = normalize(uEye-d*.56);
  vec3 q = d*5.+vec3(0.,uTime*.12,0.); float g = noise(q+noise(q*2.+uTime*.2)*1.2)*.6+noise(q*3.1-uTime*.15)*.4;   // boiling granules
  float limb = pow(1.-max(dot(d,v),0.), 2.);
  vec3 col = mix(neon(.0), neon(.08)*.6+.4, smoothstep(.25,.75,g))*(.7+1.5*g*g)*(.7+1.1*uBass+1.6*uKick) + (neon(.08)*.5+.5)*limb*.9;
  o = vec4(col, 1.); }`;
const VS_SOL_RING = VSH + `
uniform mat3 uTilt; out vec2 vP; out vec3 vW;
void main(){ float a = aUV.x*TAU, r = mix(1.9, 3.05, aUV.y); vP = aUV; vW = uTilt*vec3(cos(a)*r, 0., sin(a)*r); gl_Position = uVP*vec4(vW, 1.); }`;
const FS_SOL_RING = FSH + `
in vec2 vP; in vec3 vW; out vec4 o;
void main(){
  float u = vP.x, v = vP.y, s = spec(.03+v*.8), sS = specS(.03+v*.8);
  // streaks drawn round the ring: each radius is a band, and the inner ones turn faster
  float a = u*TAU, sp = uTime*(.5-.3*v);
  float st = noise(vec3(cos(a-sp)*7., sin(a-sp)*7., v*26.))*.6+noise(vec3(cos(a-sp*1.4)*19., sin(a-sp*1.4)*19., v*60.))*.4;
  float prof = smoothstep(0.,.12,v)*smoothstep(1.,.45,v);
  float pulse = ring(v, .5, .09, 1.8);                                              // each kick: a wave runs out through the ring
  vec3 col = mix(neon(.08), neon(.0), v)*pow(st, 3.)*prof*(.03+.55*sS*sS+.35*s*s+.8*pulse) + neon(.0)*prof*pulse*.05;
  o = vec4(col, 1.); }`;
const FS_SOL_BG = FSH + `
out vec4 o;
void main(){ vec3 rd = viewRay(); vec3 col = vec3(.0015,.002,.005) + vivid(.62)*.012*fbm(rd*2.3+3.) + stars(rd)*.8;
  float tca = -dot(uEye, rd), b = length(cross(uEye, rd));
  if (tca > 0.) col += (neon(.08)*.6+neon(.0)*.4)*exp(-max(b-1.1,0.)*5.5)*(.05+.12*uBassS+.16*uKick);   // light leaking round the shell
  o = vec4(col, 1.); }`;
scene({ id: 'solaris', name: 'Solaris Relic', from: 'Neon', kind: 'sphere', group: 'refined', pal: 0,
  about: 'A broken shell of obsidian plates standing off a small star: each plate lifts with its band, and the light pours out through the gaps',
  inputs: ['specS', 'spec', 'bassS', 'bass', 'kick', 'pulse'],
  cost: 'Moderate: the shell is five layers of a 256 grid (650k triangles) with alpha-to-coverage. Phones: three layers of a 128 grid.',
  post: { bloom: 0.6, thr: 0.9, knee: 0.7, spread: 0.74, ca: 0.6 },
  init() { this.bg = program(VS, FS_SOL_BG); this.shell = program(VS_SOL, FS_SOL); this.star = program(VS_SOL_STAR, FS_SOL_STAR); this.ring = program(VS_SOL_RING, FS_SOL_RING);
    this.cells = target(1024, 1024, HDR ? gl.RGBA16F : gl.RGBA8); draw(program(VS, SOL_BAKE), this.cells, 1024, 1024);
    const a = 0.34, b = 0.3, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    this.tilt = [cb, sb, 0, -sb * ca, cb * ca, sa, sb * sa, -cb * sa, ca]; },
  draw(F, out) {
    const t = F.time, c = camera(orbit(t * 0.085, 0.2 + Math.sin(t * 0.055) * 0.2, 5.3 - A.bassS * 0.12), [0, 0, 0], 0.72, 0, 0.1, 80);
    const set = u => { F.set(u); setCam(u, c); bindTex(3, this.cells.t); gl.uniform1i(u.uCells, 3); };
    beginMS(); quad(this.bg, set);
    gl.enable(gl.DEPTH_TEST); mesh(this.star, grid(64), set);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    for (let l = 0; l < 5; l++) mesh(this.shell, grid(256), u => { set(u); gl.uniform1f(u.uLayer, l / 4); });
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    mesh(this.ring, grid(128), u => { set(u); gl.uniformMatrix3fv(u.uTilt, false, this.tilt); });
    endMS(out);
  } });
}

// 46_nebula.js

// ───────────────────────── Nebula: inside a turning cloud of lit gas ─────────────────────────
{
// The whole frame is the cloud. It is marched at half resolution (it is soft; nothing is lost) and enlarged,
// with the stars added at full resolution behind it.
const FS_NEB = FSH + `
out vec4 o;
const float R = 1.25;
float dens(vec3 p, float r){
  p.xz = rot(uTime*.1+11.*(.11+.15/(.35+r)))*p.xz; p.xy = rot(.4)*p.xy;          // a whirlpool: sheared once into arms, then turning as one body, so it never winds up
  float w = noise(p*1.2+vec3(0.,uTime*.09,0.));
  p += (w-.5)*(1.15+.35*uDyn);
  float n = noise(p*2.2)*.56+noise(p*4.6+3.1)*.29+noise(p*9.3+7.7)*.15;
  float fil = 1.-abs(2.*n-1.); fil *= fil*fil;                                   // filaments where the noise folds
  float big = smoothstep(.38,.74, noise(p*.85+11.));                              // whole regions are empty, so the cloud has shape
  return (fil*fil*2.*big+n*n*n*.1)*(1.-smoothstep(.7,.98,r));
}
void main(){
  vec3 rd = viewRay(), ro = uEye;
  float b = dot(ro,rd), c = dot(ro,ro)-R*R, h = b*b-c;
  vec3 acc = vec3(0.); float tr = 1.;
  if (h > 0.){
    h = sqrt(h); float t0 = max(-b-h, 0.), t1 = -b+h;
    const int N = 36; float dt = (t1-t0)/float(N);
    float jit = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(.06711056,.00583715))));
    for (int i = 0; i < N; i++){
      vec3 p = ro+rd*(t0+(float(i)+jit)*dt); float r = length(p)/1.25, d = dens(p, r);
      float bnd = fract(noise(p*1.15+7.)*1.7+r*.35), s = mix(specS(.03+bnd*.8), spec(.03+bnd*.8), .15);   // every wisp answers its own band
      float sh = ring(r, .7, .07, 1.9)*(.4+.6*noise(p*2.3+1.));                        // a shell of light leaves the heart on every kick and fades as it goes
      vec3 e = neon(.5+r*.3+d*.12+noise(p*.7+4.)*.3)*d*(.1+1.05*s*s+1.1*sh);
      e += (neon(.12)*.55+.45)*exp(-r*r*110.)*(.3+.5*uBassS+.3*uKick);     // the star at the heart
      acc += tr*e*dt*1.25; tr *= exp(-d*dt*1.5);
    }
  }
  o = vec4(acc, tr);
}`;
const FS_NEB_UP = FSH + `
out vec4 o; uniform sampler2D uLo;
void main(){ vec3 rd = viewRay(); vec2 uv = gl_FragCoord.xy/uRes, e = 1.2/uRes; vec4 n = texture(uLo, uv);
  vec4 bl = (texture(uLo, uv+vec2(e.x,0.))+texture(uLo, uv-vec2(e.x,0.))+texture(uLo, uv+vec2(0.,e.y))+texture(uLo, uv-vec2(0.,e.y)))*.25;
  n.rgb = max(n.rgb+(n.rgb-bl.rgb)*.9, 0.);                                      // a little sharpening gives the filaments back their edge
  vec3 bg = vec3(.003,.0035,.009) + vivid(.62)*.012*fbm(rd*2.3+2.) + stars(rd)*.8;
  o = vec4(bg*n.a+n.rgb, 1.); }`;
scene({ id: 'nebula', name: 'Nebula', from: 'Claude', kind: 'field', group: 'refined', pal: 0, hue: t => 0.05 * Math.sin(t * 0.045),
  about: 'A whirlpool of lit gas filling the frame: every wisp answers its own band, and each kick sends a faint, broken shell of light out through it',
  inputs: ['spec', 'specS', 'bassS', 'kick', 'pulse', 'dyn', 'drop'],
  cost: 'Heavy: a 36-step volume march with six noise lookups a step, done at two-thirds resolution. Phones: 20 steps at a third. TVs: 28 steps.',
  post: { trail: 0.3, bloom: 0.55, thr: 0.8, knee: 0.6, spread: 0.72, exp: 1.0, ca: 0.5, pulse: 0.15 },
  init() { this.p = program(VS, FS_NEB); this.up = program(VS, FS_NEB_UP); },
  draw(F, out) {
    const t = F.time, lo = RTs('nebulaLo', 1.5);
    const c = camera(orbit(t * 0.05, 0.12 + Math.sin(t * 0.045) * 0.16, 1.72), [Math.sin(t * 0.07) * 0.22, Math.sin(t * 0.05) * 0.14, Math.cos(t * 0.06) * 0.15], 0.8, Math.sin(t * 0.04) * 0.2, 0.1, 60);
    draw(this.p, lo, lo.w, lo.h, u => { F.set(u); setCam(u, c); gl.uniform2f(u.uRes, lo.w, lo.h); });
    draw(this.up, out, T.sw, T.sh, u => { F.set(u); setCam(u, c); bindTex(3, lo.t); gl.uniform1i(u.uLo, 3); });
  } });
}

// 50_silk.js

// ───────────────────────── Silk: two million particles drawn off two rings into sheets of woven light ─────────────────────────
{
const SILK_W = stage.constrained ? 512 : 2048, SILK_H = stage.constrained ? 256 : 1024, SILK_THREADS = 1500;
// A divergence-free flow built from a handful of sine modes: the curl of ψ = Σ e·sin(k·p+φ) is Σ (k×e)·cos(k·p+φ).
const SILK_FLOW = `
vec3 flow(vec3 p, float t){
  vec3 v = cross(vec3(.9,.3,-.5), vec3(0.,1.,0.))*cos(dot(vec3(.9,.3,-.5),p)+t*1.1);
  v += cross(vec3(-.4,1.1,.6), vec3(1.,0.,0.))*cos(dot(vec3(-.4,1.1,.6),p)-t*.9+1.3);
  v += cross(vec3(.5,-.7,1.2), vec3(0.,0.,1.))*cos(dot(vec3(.5,-.7,1.2),p)+t*.7+2.1)*.9;
  v += cross(vec3(1.7,.6,.9), vec3(0.,1.,0.))*cos(dot(vec3(1.7,.6,.9),p)-t*1.6+.4)*.45;
  v += cross(vec3(-1.3,1.9,-.8), vec3(1.,0.,0.))*cos(dot(vec3(-1.3,1.9,-.8),p)+t*1.9+4.)*.35;
  v += cross(vec3(2.6,-1.4,2.1), vec3(0.,0.,1.))*cos(dot(vec3(2.6,-1.4,2.1),p)+t*2.6+5.2)*.16;
  return v; }
vec3 wind(vec3 p){ return flow(p*1.15, uTime*.22)*(.34+.7*uMidS+.2*uDyn) + vec3(-p.z, 0., p.x)*.5; }`;
const FS_SILK_SIM = HEAD + LIB + SILK_FLOW + `
uniform sampler2D uState; uniform float uDt; out vec4 o;
void main(){
  ivec2 ij = ivec2(gl_FragCoord.xy); vec4 s = texelFetch(uState, ij, 0);
  float h1 = hash2(vec2(ij)+.5), h2 = hash2(vec2(ij)*1.7+9.1), h3 = hash2(vec2(ij)*.61+3.7);
  vec3 p = s.xyz; float life = s.w;
  vec3 v = wind(p);
  v -= p*smoothstep(1.9, 3.4, length(p))*.6;                     // a soft wall
  v += normalize(p+1e-4)*uKick*1.7;                              // each beat pushes the cloth outward
  p += v*uDt; life -= uDt*(.2+.08*h3);
  if (life <= 0.){
    // every particle belongs to one of a fixed set of threads, so the cloud reads as drawn lines
    float n = floor(h1*${SILK_THREADS}.), th = (n+.5)/${SILK_THREADS}., a = th*TAU+uTime*.05, R = .62+.22*uBassS;
    if (fract(n*.381966) < .34){                                 // a third of the threads leave from a second, smaller, tilted ring
      p = vec3(cos(a*2.)*R*.5, sin(a*2.)*R*.5, .1*sin(a*10.+uTime*.7)); p.yz = rot(.9)*p.yz; p.xz = rot(uTime*.07)*p.xz; }
    else p = vec3(cos(a)*R, .22*sin(a*3.+uTime*.5)+.07*sin(a*7.-uTime*.9), sin(a)*R);
    p += (vec3(h2,h3,fract(h2*37.))-.5)*.0028;
    life = s.w == 0. ? h2 : 1.;
  }
  o = vec4(p, life);
}`;
// Each point is shaded as a piece of thread running along the flow: light glances off a fibre in a band
// across it (the Kajiya–Kay model for hair and cloth, 1989), which is what gives the sheets their sheen.
const VS_SILK = HEAD + LIB + SILK_FLOW + `
uniform sampler2D uState; uniform float uFocus, uAp, uDpr; out vec3 vCol;
void main(){
  ivec2 ij = ivec2(gl_VertexID % ${SILK_W}, gl_VertexID / ${SILK_W}); vec4 s = texelFetch(uState, ij, 0);
  float h1 = hash2(vec2(ij)+.5); vec3 p = s.xyz;
  gl_Position = uVP*vec4(p,1.); float d = max(gl_Position.w, .05);
  float size = max(1., abs(d-uFocus)/d*uAp)*uDpr; gl_PointSize = min(size, 40.);
  float fade = smoothstep(0.,.12,s.w)*smoothstep(1.,.96,s.w)*smoothstep(2.7,1.7,length(p));
  float th = (floor(h1*${SILK_THREADS}.)+.5)/${SILK_THREADS}., band = abs(th*2.-1.), sp = spec(.02+band*.8);
  float lead = fract(sin(th*9173.3)*43758.5);                                // a few threads are drawn brighter
  vec3 T = normalize(wind(p)+1e-4), V = normalize(uEye-p), L = normalize(vec3(.45,.8,.35)), H = normalize(L+V);
  float th_ = dot(T,H), sheen = pow(max(1.-th_*th_, 0.), 48.), tl = dot(T,L), diff = sqrt(max(1.-tl*tl, 0.));
  float back = pow(max(dot(V, -L), 0.), 3.);                                 // and glows where the light is behind the cloth
  vec3 base = vivid(.5+band*.42+length(p)*.06+s.w*.14);                      // colour drifts along a thread as it ages
  vec3 c = base*(.02+.16*diff+.3*back)*(.35+1.7*sp*sp) + (base*.4+.6)*sheen*(.22+1.5*sp*sp+.5*uKick);
  vCol = c*(.45+1.6*lead*lead)*fade*(1.5/(size*size));
}`;
const FS_SILK_BG = FSH + `
out vec4 o;
void main(){ vec2 q = (gl_FragCoord.xy*2.-uRes)/uRes.y; float r = length(q);
  o = vec4(vec3(.003,.0035,.008)*(1.2-r*.4) + vivid(.62)*.014*exp(-r*r*1.5)*(.5+uBassS+.6*uKick), 1.); }`;
scene({ id: 'silk', name: 'Silk', from: 'Fable', kind: 'field', group: 'refined', pal: 0,
  about: 'Two million particles drawn off two rings along fixed threads by a curl field, lit like real silk: sheets of woven light with a moving sheen',
  inputs: ['spec', 'midS', 'bassS', 'kick', 'dyn'],
  cost: 'Heavy on fill and memory: two million additive points and two 2048×1024 float textures. Phones: 260k particles (512²). TVs: one million.',
  post: { trail: 0.5, bloom: 0.6, thr: 0.35, ca: 0.6 },
  init() { this.sim = program(VS, FS_SILK_SIM); this.pts = program(VS_SILK, FS_POINT); this.bg = program(VS, FS_SILK_BG);
    this.a = simTarget(SILK_W, SILK_H, gl.RGBA32F, gl.NEAREST); this.b = simTarget(SILK_W, SILK_H, gl.RGBA32F, gl.NEAREST); },
  draw(F, out) {
    draw(this.sim, this.b, SILK_W, SILK_H, u => { F.set(u); bindTex(3, this.a.t); gl.uniform1i(u.uState, 3); gl.uniform1f(u.uDt, Math.min(F.dt, 1 / 30)); });
    [this.a, this.b] = [this.b, this.a];
    const t = F.time, R = 5.6 - A.kick * 0.15, c = camera(orbit(t * 0.08, 0.42 + Math.sin(t * 0.06) * 0.25, R), [0, 0, 0], 0.72, 0, 0.1, 60);
    beginTo(out); quad(this.bg, u => { F.set(u); setCam(u, c); });
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    points(this.pts, SILK_W * SILK_H, u => { F.set(u); setCam(u, c); bindTex(3, this.a.t); gl.uniform1i(u.uState, 3);
      gl.uniform1f(u.uFocus, R * 0.95); gl.uniform1f(u.uAp, 5.5); gl.uniform1f(u.uDpr, F.px); });
  } });
}

// 51_hyperspace.js

// ───────────────────────── Hyperspace: flying up a shaft of stars; the music is the speed, the stars and the hoops ─────────────────────────
{
// Three things, each tied to one part of the music so the link is easy to read:
//   speed      the bass and the kick drive how fast you travel, and so how long every streak is drawn
//   stars      each star belongs to a band and shines with it; fuller music brings more of them out
//   hoops      every kick lets go one hoop of light far ahead, and it rushes up and past you
// with a dial of the spectrum standing round the vanishing point.
const HYP_N = 3600;
const VS_STREAK = VSP + `
uniform float uZ, uLen; out vec3 vCol; out vec2 vE;
void main(){
  uint id = uint(gl_InstanceID)*6u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), band = hashu(id+3u), h5 = hashu(id+4u), h6 = hashu(id+5u);
  const float DEPTH = 90.;
  float ang = h1*TAU, rad = 1.8+pow(h2, .65)*14., z = mod(h3*DEPTH-uZ*(.7+.6*h5), DEPTH);     // it only wraps far ahead, where it is faded out
  float s = spec(.02+band*.8), sS = specS(.02+band*.8), len = uLen*(.6+.8*h5)*(.5+1.3*sS);
  float za = max(z, .7), end = float(gl_VertexID == 1 || gl_VertexID == 2 || gl_VertexID == 4), side = (gl_VertexID == 2 || gl_VertexID == 4 || gl_VertexID == 5) ? 1. : -1.;
  vec4 pa = uVP*vec4(cos(ang)*rad, sin(ang)*rad, za, 1.), pb = uVP*vec4(cos(ang)*rad, sin(ang)*rad, za+len, 1.);
  vec2 sa = pa.xy/pa.w, sb = pb.xy/pb.w, dpx = (sb-sa)*uRes, n = normalize(vec2(-dpx.y, dpx.x)+1e-6);
  float w = (.7+.9*s+1.1/za)*uPx;
  gl_Position = vec4(mix(sa, sb, end)+n*side*w/uRes*2., 0., 1.);
  float shown = smoothstep(h6-.12, h6+.12, .22+.9*uDyn);                                     // fuller music brings more stars out
  vCol = neon(.5+band*.5)*(.03+.9*s*s+.1*uKick)*smoothstep(DEPTH, DEPTH*.7, z)*smoothstep(.7, 3.5, z)*shown;
  vE = vec2(end, side);
}`;
const FS_STREAK = `#version 300 es
precision highp float; in vec3 vCol; in vec2 vE; out vec4 o;
void main(){ o = vec4(vCol*mix(1., .08, vE.x)*(1.-vE.y*vE.y), 1.); }`;                         // bright at the head, fading down the tail
const FS_HYP_BG = FSH + `
out vec4 o;
void main(){
  vec2 q = (gl_FragCoord.xy*2.-uRes)/uRes.y; vec4 pc = uVP*vec4(0., 0., 60., 1.); vec2 ctr = pc.xy/pc.w*vec2(uAspect, 1.), d = q-ctr;
  float r = length(d), ang = atan(d.y, d.x);
  vec3 col = vec3(.002,.0025,.006)+neon(.6)*.012*exp(-r*1.6)+(neon(.12)*.6+.4)*exp(-r*r*160.)*(.1+.5*uBassS+.7*uKick);   // the light you are flying toward
  // the dial: the spectrum standing round the vanishing point
  float u = fract(ang/TAU+.5+uTime*.004), cell = floor(u*120.), band = abs((cell+.5)/120.*2.-1.), sS = specS(.02+band*.82), s = spec(.02+band*.82);
  float fu = abs(fract(u*120.)-.5), bar = smoothstep(.32,.22,fu)*smoothstep(.085,.095,r)*smoothstep(.1+.3*sS*sS+.004, .1+.3*sS*sS, r);
  col += neon(.55+band*.45)*bar*(.12+1.6*s*s);
  // the hoops: one for every kick, let go far ahead, rushing up and past
  for (int i = 0; i < 8; i++){ float a = uPulse[i]; if (a > 1.5) continue;
    float z = 62.*pow(max(1.-a/1.35, 0.), 2.4)+.6; vec4 ph = uVP*vec4(0., 0., z, 1.); vec2 hc = ph.xy/ph.w*vec2(uAspect, 1.);
    float rs = 3.4/(z*uTan), dd = length(q-hc)-rs, wd = .004+.035/z;
    col += (neon(.1+float(i)*.11)*.75+.25)*(exp(-dd*dd/(wd*wd))+.25*exp(-abs(dd)/(wd*6.)))*smoothstep(0.,.1,a)*(1.-smoothstep(1.1,1.35,a))*(1.1+.5/z); }
  col += neon(.9)*pow(noise(vec3(ang*9., uTime*.5, 3.)), 5.)*uSnare*exp(-r*1.2)*.5;            // snares: a flicker of spokes
  o = vec4(col, 1.);
}`;
scene({ id: 'tunnel', name: 'Hyperspace', from: 'Claude', kind: 'field', group: 'refined', pal: 0,
  about: 'Flying up a shaft of stars: bass and kick are your speed (and the length of every streak), each star shines with its own band, fuller music brings out more of them, and every kick sends a hoop of light rushing past',
  inputs: ['spec', 'specS', 'bassS', 'kick', 'snare', 'pulse', 'dyn', 'travel'],
  cost: 'Light: 3,600 additive streaks and one full-screen pass. Fine on phones.',
  post: { trail: 0.25, bloom: 0.5, thr: 0.7, ca: 0.8, vig: 0.9, pulse: 0.5 },
  init() { this.bg = program(VS, FS_HYP_BG); this.stars = program(VS_STREAK, FS_STREAK); this.speed = 1; },
  draw(F, out) {
    const t = F.time; this.speed += (0.55 + 2.2 * A.bassS + 1.2 * A.kick - this.speed) * (1 - Math.exp(-F.dt * 6));
    const c = camera([Math.sin(t * 0.13) * 0.5, Math.sin(t * 0.1) * 0.35, 0], [Math.sin(t * 0.07) * 1.5, Math.sin(t * 0.09) * 1, 30], 0.95 + 0.25 * A.dyn, Math.sin(t * 0.05) * 0.3, 0.2, 200);
    const set = u => { F.set(u); setCam(u, c); gl.uniform1f(u.uZ, (F.travel * 20) % 90000); gl.uniform1f(u.uLen, 0.3 + 1.5 * this.speed); };
    beginTo(out); quad(this.bg, set);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.stars.p); set(this.stars.u); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, HYP_N);
  } });
}

// 53_aurora.js

// ───────────────────────── Aurora: curtains of light over a still lake ─────────────────────────
{
// The curtains are marched at half resolution; the stars, the mountains, the pines on the near shore and the
// lake are drawn at full resolution over that, and the lake mirrors the curtains by reading the same texture.
const AUR_CAM = `
uniform float uYaw;
vec2 scr(){ return (gl_FragCoord.xy*2.-uRes)/uRes.y; }
vec3 dirOf(vec2 q){ vec3 rd = normalize(vec3(q.x, q.y+.46, 1.55)); rd.xz = rot(uYaw)*rd.xz; return rd; }`;
// Three curtains hang across the sky, one behind another: the near one is the bass, the middle one the mids,
// the far one the highs, and along each the pitch runs from left to right. A curtain is a wandering line on the
// map (so it folds, and is brightest where you look along a fold); each stretch of it hangs as tall as its band
// is loud. The march takes fourteen samples through the depth of each curtain.
const FS_AUR = FSH + AUR_CAM + `
out vec4 o;
float curtZ(float fi, float x){ float t = uTime;
  return 7.+fi*5.5+1.6*sin(x*.21+t*.05+fi*2.)+.9*sin(x*.53-t*.08+fi*4.)+(.3+.45*uDyn)*sin(x*1.37+t*.21+fi)+.12*sin(x*3.9-t*.5+fi*5.); }
void main(){
  vec3 rd = dirOf(scr()), acc = vec3(0.);
  if (rd.y > .0){
    vec2 hd = normalize(rd.xz); float tanEl = rd.y/length(rd.xz);
    float jit = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(.06711056,.00583715))));
    for (int ci = 0; ci < 3; ci++){ float fi = float(ci), z0 = 7.+fi*5.5, r0 = (z0-3.6)/hd.y, dr = 7.2/hd.y/14.;
      for (int s = 0; s < 14; s++){
        float rho = r0+(float(s)+jit)*dr; vec2 p = hd*rho; float alt = rho*tanEl;
        float dz = p.y-curtZ(fi, p.x), dens = exp(-dz*dz/.2);
        if (dens < .004 || alt > 11.) continue;
        float f = clamp(.5+p.x/(z0*1.7), 0., 1.), band = .02+(fi+f)*.27, sS = specS(band), sm = mix(sS, spec(band), .2);
        float base = 1.5+.55*fi+.22*sin(p.x*.4+fi*3.+uTime*.1), top = base+.5+5.5*sS*sS*(.5+.7*uDyn), h = (alt-base)/(top-base);
        if (h < 0.) continue;
        float prof = smoothstep(0.,.05,h)*exp(-h*2.7);                                       // a sharp lower hem, fading upward
        float rays = .3+.7*pow(noise(vec3(p.x*4.6+fi*17., uTime*.4, fi*3.)), 2.)*(.6+.8*noise(vec3(p.x*15.+fi*5., uTime*.7, 2.)));   // the fine rays, shimmering
        float run = ring(abs(p.x), 12., 1.5, 1.7), up = ring(h, .9, .15, 1.2);               // each kick: light runs out along the curtains, and climbs them
        vec3 c = neon(.02+h*.5+fi*.035);
        c += neon(.6)*smoothstep(0.,.03,h)*(1.-smoothstep(.03,.12,h))*sm*sm*1.6;             // a second colour along the hem when its band is loud
        acc += c*dens*prof*rays*(.22+2.3*sm*sm+.65*run+.4*up+.25*uDrop)*dr*exp(-rho*.025)*(1.-.18*fi);
      } }
    acc *= .95;
  }
  o = vec4(acc, 1.);
}`;
const FS_AUR_UP = FSH + AUR_CAM + `
out vec4 o; uniform sampler2D uLo;
float skyline(float az){ float x = az*2.6+11., h = 0., a = .55;
  for (int i = 0; i < 4; i++){ h += a*(1.-abs(2.*noise(vec3(x, 3.7, float(i)))-1.)); x *= 2.1; a *= .5; }
  return .012+.085*h*h; }
float pines(float az, float el){                       // the near shore: black conifers either side, the middle left open
  float m = smoothstep(.22,.6,abs(az)), x = az*14., cov = 0.;
  for (int j = -2; j <= 2; j++){ float c = floor(x)+float(j), hh = hash2(vec2(c, 3.)), ac = (c+.5+(hh-.5)*.8)/14.;
    float top = -.26+m*(.2+.42*hash2(vec2(c, 9.))), dy = top-el;
    if (dy > 0.){ float hw = (.004+dy*.17*(.5+.5*(1.-fract(dy*24.+hh*3.))))*(.8+.5*hh);      // tiers of branches, wider toward the ground
      cov = max(cov, smoothstep(hw+.0025, hw-.0025, abs(az-ac))); } }
  return cov; }
vec3 lo(vec2 q){ vec2 uv = (q*uRes.y+uRes)*.5/uRes; return uv.y < 1. ? texture(uLo, uv).rgb : vec3(0.); }
vec3 sky(vec2 q, float st){ vec3 rd = dirOf(q); float az = atan(rd.x, rd.z);
  vec3 col = mix(vec3(.004,.012,.02), vec3(.0015,.002,.006), smoothstep(0.,.6,rd.y)) + neon(.05)*.012*exp(-rd.y*6.);
  col += vec3(.012,.014,.022)*smoothstep(.35,.8, fbm(vec3(rd.xy*3.+rd.z, 5.)))*smoothstep(.1,.5,rd.y)*st;      // a faint river of stars
  col += stars(rd)*.8*st*smoothstep(.02,.2,rd.y);
  col += lo(q);
  float m = skyline(az);
  vec3 glow = lo(vec2(q.x, .25))*.03;                                       // snow on the peaks takes a little of the light
  return mix(col, vec3(.0012,.002,.004)+glow*smoothstep(.3,1.,rd.y/m), smoothstep(m+.004, m-.004, rd.y)); }
void main(){
  vec2 q = scr(); vec3 rd = dirOf(q), col;
  if (rd.y >= 0.) col = sky(q, 1.);
  else {                                                                    // the lake: the same sky, upside down and gently rippled
    float t = .35/(-rd.y); vec2 g = rd.xz*t;
    float rip = (noise(vec3(g*vec2(3.,9.), uTime*.35))-.5)+(noise(vec3(g*vec2(9.,26.)+4., uTime*.6))-.5)*.5;
    vec2 qm = vec2(q.x+rip*.012, -q.y-.92+rip*.04*(.4+uHigh)+.004);
    col = (sky(qm, .5)*.6+sky(qm+vec2(0.,.03), .5)*.25+sky(qm+vec2(0.,.07), .5)*.15);      // reflections draw out into streaks
    col *= (.5+.5*pow(1.-clamp(-rd.y*3.,0.,1.), 3.))*vec3(.86,.94,1.); col += vec3(.0006,.001,.002);
  }
  col += neon(.05)*.012*exp(-abs(rd.y)*60.)*(.5+uLevelS);                     // mist along the far shore
  float el = rd.y/length(rd.xz);
  col *= 1.-pines(atan(rd.x, rd.z), el);
  o = vec4(col, 1.);
}`;
scene({ id: 'aurora', name: 'Aurora', from: 'Claude', kind: 'field', group: 'refined', pal: 6, hue: t => Math.sin(t * 0.05) * 0.06,
  about: 'Three aurora curtains over a still lake, framed by pines: bass in front, highs behind, pitch from left to right; each stretch hangs as tall as its band is loud, and kicks send light running along them',
  inputs: ['spec', 'specS', 'high', 'levelS', 'kick', 'pulse', 'dyn', 'drop'],
  cost: 'Heavy: 42 samples a pixel (two noise lookups each) at half resolution. Phones: two curtains of eight samples at a third. TVs: ten samples.',
  post: { bloom: 0.5, thr: 0.6, knee: 0.6, spread: 0.74, ca: 0.3, vig: 0.8, pulse: 0.2 },
  init() { this.p = program(VS, FS_AUR); this.up = program(VS, FS_AUR_UP); },
  draw(F, out) {
    const lo = RTs('auroraLo', 2), yaw = Math.sin(F.time * 0.045) * 0.22;
    draw(this.p, lo, lo.w, lo.h, u => { F.set(u); gl.uniform2f(u.uRes, lo.w, lo.h); gl.uniform1f(u.uYaw, yaw); });
    draw(this.up, out, T.sw, T.sh, u => { F.set(u); gl.uniform1f(u.uYaw, yaw); bindTex(3, lo.t); gl.uniform1i(u.uLo, 3); });
  } });
}

// 60_watercolour.js

// ═════════════════════════ Organic scenes ═════════════════════════
// ───────────────────────── Watercolour: wet paint blooming and bleeding on cold-pressed paper ─────────────────────────
{
// A small simulation on a 960×600 sheet: three pigments and the wetness of the paper. Wet paint drifts and
// spreads; where a new drop lands it pushes the wash outward; pigment fades slowly so the sheet keeps renewing.
// The picture is paper seen through the paint (pigments subtract light), with the pigment gathered at the
// edges of each wash and settled into the tooth of the paper, the way real watercolour dries.
const WC_W = stage.constrained ? 480 : 960, WC_H = stage.constrained ? 300 : 600;
const WC_PAINT = `
vec3 paintOf(float k){ k = mod(k, 3.); return clamp(vec3(max(1.-abs(k), 1.-abs(k-3.)), 1.-abs(k-1.), 1.-abs(k-2.)), 0., 1.); }`;
// Three kinds of mark, one for each part of the music:
//   washes   low frequencies (every kick): big, pale, wet, with no edge to speak of; they bleed and merge
//   strokes  mids (every note that starts): a loaded brush drawn quickly across the sheet, bristle-streaked,
//            running dry toward its end; its colour comes from the pitch of the note
//   dots     highs: single dots on the hats, a flicked splatter on the snares
const FS_WC_SIM = HEAD + LIB + WC_PAINT + `
in vec2 uv; out vec4 o;
uniform sampler2D uState; uniform float uDt; uniform float uWashAge[8]; uniform vec4 uDropP[8], uSpl[4], uStk[6], uStk2[6], uDot[8];
const float ASP = 1.6, DUR = .5;
float psi(vec2 p){ return noise(vec3(p*3.2, uTime*.05)); }
float land(float a){ return exp(-a*12.)*3.6; }           // paint leaves the brush over a moment, never all at once
void main(){
  vec2 p = uv*vec2(ASP, 1.), tx = 1./vec2(${WC_W}., ${WC_H}.); const float e = .02;
  // wet paint wanders: a slow, divergence-free drift; each fresh wash pushes outward from where it lands
  vec2 v = vec2(psi(p+vec2(0.,e))-psi(p-vec2(0.,e)), psi(p-vec2(e,0.))-psi(p+vec2(e,0.)))/(2.*e)*.011*(.5+uMidS);
  for (int i = 0; i < 8; i++){ float a = uWashAge[i]; if (a > 1.2) continue; vec2 d = (uv-uDropP[i].xy)*vec2(ASP, 1.); float R = uDropP[i].z;
    v += d/(length(d)+1e-4)*exp(-dot(d,d)/(R*R*1.6))*smoothstep(0.,.1,a)*(1.-smoothstep(.2,1.,a))*.09; }
  float wet0 = texture(uState, uv).a;
  vec2 src = uv-v/vec2(ASP, 1.)*uDt*(.25+wet0);
  vec4 s = texture(uState, src);
  vec4 av = (texture(uState, src+vec2(tx.x*1.5,0.))+texture(uState, src-vec2(tx.x*1.5,0.))+texture(uState, src+vec2(0.,tx.y*1.5))+texture(uState, src-vec2(0.,tx.y*1.5)))*.25;
  float k = clamp(s.a*uDt*24., 0., .6); s.rgb = mix(s.rgb, av.rgb, k); s.a = mix(s.a, av.a, k*.6);      // wet-in-wet: paint spreads where the paper is wet
  // washes
  for (int i = 0; i < 8; i++){ float a = uWashAge[i]; if (a > .7) continue; vec2 d = (uv-uDropP[i].xy)*vec2(ASP, 1.); float r = length(d);
    float R=uDropP[i].z, seed=uDropP[i].w;
    float theta=atan(d.y,d.x), petal=.5+.5*sin(theta*9.+seed+1.5*sin(theta*3.+seed));
    float jag=.66+.25*petal+.22*noise(vec3(d*22.,seed));
    float rr=r/max(.001,R*jag);
    float reach=.55+.60*(1.-exp(-a*23.)), crown=exp(-pow((rr-reach)/.13,2.));
    float wet=(1.-smoothstep(reach*.48,reach,rr));
    float hit=exp(-a*18.)*(wet*1.4+crown*.95);
    vec3 centre=paintOf(seed), fringe=paintOf(seed+.85+petal*.42);
    vec3 pigment=mix(centre,fringe,smoothstep(.13,.99,rr))*(.82+.37*petal);
    // Replace some previous pigment where the drop pushes a wet layer aside.
    s.rgb=mix(s.rgb,pigment*2.05,clamp(hit*uDt*23.,0.,.86));
    vec2 fleckGrid=d/(R+.0001)*13., cell=floor(fleckGrid);
    vec2 offset=fract(fleckGrid)-vec2(hash2(cell+seed),hash2(cell+seed+3.));
    float spatter=exp(-dot(offset,offset)*31.)*step(.72,hash2(cell+seed+9.))*smoothstep(.50,.9,rr)*(1.-smoothstep(1.,1.7,rr));
    s.rgb+=fringe*spatter*exp(-a*23.)*uDt*27.;
    s.a=max(s.a,wet*.72);
  }
  // Each note prints the edges of a small faceted stone. Some facets share a translucent wash.
  // Compute segment distance analytically so even a single slow frame leaves a connected mark.
  for (int i=0;i<6;i++){
    float age=uStk[i].w; if(age>.22) continue;
    vec2 d=rot(uStk[i].z)*(p-uStk[i].xy*vec2(ASP,1.));
    float radius=.043+uStk2[i].x*.32;
    d/=radius; d.y*=1.1+abs(uStk2[i].z)*.7;
    if(dot(d,d)>2.2) continue;
    float seed=uStk2[i].w*8.3, sides=4.+floor(fract(seed)*4.);
    float angle=mod(atan(d.y,d.x)+TAU,TAU), wedge=TAU/sides, ix=floor(angle/wedge);
    float a0=ix*wedge, a1=(ix+1.)*wedge;
    vec2 v0=vec2(cos(a0),sin(a0))*(.68+.32*hash2(vec2(ix,seed)));
    vec2 v1=vec2(cos(a1),sin(a1))*(.68+.32*hash2(vec2(mod(ix+1.,sides),seed)));
    vec2 edge=v1-v0;
    float outside=-(edge.x*(d.y-v0.y)-edge.y*(d.x-v0.x))/length(edge);
    vec2 hub=.19*vec2(cos(seed),sin(seed));
    vec2 rib=v0-hub;
    float seam=length(d-hub-rib*clamp(dot(d-hub,rib)/dot(rib,rib),0.,1.));
    float fibre=.72+.28*noise(vec3(p*175.,seed));
    float outline=exp(-abs(outside)*34.)+exp(-seam*46.)*(1.-smoothstep(-.02,.02,outside))*.72;
    float tint=(1.-smoothstep(-.02,.02,outside))*(.04+.16*hash2(vec2(ix,seed+1.)));
    float mark=(outline+tint)*fibre*exp(-age*27.)*min(uDt*37.,1.);
    s.rgb+=paintOf(seed+ix*.12)*mark; s.a=max(s.a,mark*.14);
  }
  // dots (hats) and splatter (snares)
  for (int i = 0; i < 8; i++){ float a = uDot[i].w; if (a > .4) continue; float dd = length((uv-uDot[i].xy)*vec2(ASP, 1.))/uDot[i].z;
    s.rgb += (paintOf(float(i)*1.3)*.6+.5)*smoothstep(1., .7, dd)*land(a)*uDt*9.; s.a = max(s.a, smoothstep(1.3, .8, dd)*.3*smoothstep(0.,.1,a)); }
  for (int j = 0; j < 4; j++){ float a = uSpl[j].w; if (a > .5) continue; vec2 q = (uv-uSpl[j].xy)*vec2(ASP, 1.)/.03, c = floor(q); float sd = uSpl[j].z;
    float h = hash2(c+sd*17.), keep = step(.74, h)*smoothstep(8., 1., length(c)+3.*hash2(c+sd*5.));
    float dd = length(q-c-.12-.76*vec2(hash2(c+sd), hash2(c+sd+3.)));
    s.rgb += paintOf(sd*3.+h)*smoothstep(.12+.3*h, .04, dd)*keep*land(a)*uDt*7.; s.a = max(s.a, smoothstep(.5, .1, dd)*keep*.5*smoothstep(0.,.1,a)); }
  s.a = max(s.a-uDt*.04, 0.);                                              // the paper dries
  s.rgb = min(s.rgb*exp(-uDt*.018), vec3(3.));                             // and old paint fades, so the sheet keeps renewing
  o = s;
}`;
const FS_WC = FSH + COVER + `
out vec4 o; uniform sampler2D uState;
float tooth(vec2 p){ return noise(vec3(p*150., 1.))*.45+noise(vec3(p*64., 5.))*.35+noise(vec3(p*vec2(22., 300.), 9.))*.2; }
void main(){
  vec2 uv = cover(gl_FragCoord.xy/uRes, 1.6), p = uv*vec2(1.6, 1.), e = 1.5/vec2(${WC_W}., ${WC_H}.);
  vec4 s = texture(uState, uv);
  vec3 gx = texture(uState, uv+vec2(e.x,0.)).rgb-texture(uState, uv-vec2(e.x,0.)).rgb, gy = texture(uState, uv+vec2(0.,e.y)).rgb-texture(uState, uv-vec2(0.,e.y)).rgb;
  float th = tooth(p), dens = dot(s.rgb, vec3(1.)), edge = length(vec2(dot(gx, vec3(1.)), dot(gy, vec3(1.))));
  vec3 pig = s.rgb*(1.+(.5-th)*.6*(1.-.6*s.a)) + s.rgb/max(dens, 1e-3)*edge*2.6*(1.-.5*s.a);   // settled in the hollows, gathered at the edges
  // three paints; what they do not absorb is what you see
  vec3 c0 = mix(vec3(.1,.24,.7), neon(.0), .1), c1 = mix(vec3(.82,.13,.27), neon(.33), .1), c2 = mix(vec3(.96,.66,.14), neon(.66), .1);
  vec3 T = exp(-(pig.r*-log(max(c0, .04))+pig.g*-log(max(c1, .04))+pig.b*-log(max(c2, .04)))*.85);
  vec3 paper = vec3(.93,.905,.85)*(.9+.14*th)*(1.-.07*s.a);
  paper *= .97+.03*noise(vec3(p*vec2(3., 60.), 3.));                         // faint laid lines
  vec2 q = gl_FragCoord.xy/uRes-.5;
  o = vec4(paper*T*(1.02-.5*dot(q,q)), 1.);
}`;
scene({ id: 'wash', name: 'Watercolour', from: 'Organic', kind: 'paint', group: 'organic', pal: 0, hue: () => 0,
  about: 'Wet paint on cold-pressed paper, with a brush for each part of the music: big soft washes on the low end, quick bristled strokes for every note (coloured by its pitch), dots and splatter for the hats and snares',
  inputs: ['midS', 'bassS', 'pulse', 'notes, hats, snares (onsets)', 'noteBand', 'noteAmp', 'hatAmp'],
  cost: 'Light: one 960×600 simulation pass and one full-screen pass. Phones: a 640×400 sheet.',
  post: { bloom: 0.08, thr: 1.6, exp: 1.0, ca: 0.15, vig: 0.35, grain: 0.03, pulse: 0 },
  init() { this.sim = program(VS, FS_WC_SIM); this.show = program(VS, FS_WC);
    this.a = simTarget(WC_W, WC_H); this.b = simTarget(WC_W, WC_H);
    this.drops = new Float32Array(32); this.spl = new Float32Array(16).fill(9); this.stk = new Float32Array(24).fill(9); this.stk2 = new Float32Array(24); this.dot = new Float32Array(32).fill(9);
    this.washAge = new Float32Array(8).fill(9); this.washSlot=0; this.beat=A.beat; this.sn = A.snares; this.nn = A.notes; this.hn = A.hats; this.si = 0; this.ki = 0; this.di = 0; },
  draw(F, out) {
    const t = F.time, r = Math.random, D = this.drops, S = this.spl, K = this.stk, K2 = this.stk2, O = this.dot;
    // the hand wanders the sheet slowly; strokes and dots fall near it, so the picture has a centre that moves
    const hand = [0.5 + 0.34 * Math.sin(t * 0.13 + Math.sin(t * 0.07) * 2), 0.5 + 0.3 * Math.sin(t * 0.17 + 1.3 + Math.cos(t * 0.05) * 2)];
    for (let j = 0; j < 4; j++) S[j * 4 + 3] += F.dt;
    for (let j = 0; j < 6; j++) K[j * 4 + 3] += F.dt;
    for (let j = 0; j < 8; j++) O[j * 4 + 3] += F.dt;
    for(let j=0;j<8;j++) this.washAge[j]+=F.dt;
    if(this.beat!==A.beat){
      this.beat=A.beat;
      const i=this.washSlot++ % 8, strength=Math.min(1,A.kickAmp/(1.35*Math.max(1,A.kMean)));
      D.set([.23+r()*.54,.23+r()*.54,.105+.28*strength**3,(this.washSlot*.89)%3],i*4);
      this.washAge[i]=0;
    }
    if (A.notes !== this.nn) { this.nn = A.notes; const j = this.ki++ % 6, len = 0.07 + 0.34 * r() ** 1.5 + 0.14 * A.noteAmp;
      K.set([hand[0] + (r() - 0.5) * 0.46, hand[1] + (r() - 0.5) * 0.48, r() * 6.283, 0], j * 4); K2.set([len, 0.007 + 0.014 * A.noteAmp + 0.005 * r(), (r() - 0.5) * 2.2, A.noteBand * 9 + this.ki * 0.41], j * 4); }
    if (A.hats !== this.hn) {
      this.hn=A.hats;
      const angle=r()*6.283, cx=.16+.68*r(), cy=.16+.68*r();
      for(let j=0;j<5;j++){
        const dist=(j-2)*.029;
        O.set([cx+dist*Math.cos(angle),cy+dist*Math.sin(angle)+.009*r(),.006+.012*A.hatAmp+.004*r(),0],(this.di++ & 7)*4);
      }
    }
    if (A.snares !== this.sn) { this.sn = A.snares; S.set([hand[0] + (r() - 0.5) * 0.4, hand[1] + (r() - 0.5) * 0.4, r(), 0], (this.si++ & 3) * 4); }
    draw(this.sim, this.b, WC_W, WC_H, u => { F.set(u); bindTex(3, this.a.t); gl.uniform1i(u.uState, 3); gl.uniform1f(u.uDt, Math.min(F.dt, 1 / 30));
      gl.uniform1fv(u.uWashAge,this.washAge); gl.uniform4fv(u.uDropP, D); gl.uniform4fv(u.uSpl, S); gl.uniform4fv(u.uStk, K); gl.uniform4fv(u.uStk2, K2); gl.uniform4fv(u.uDot, O); });
    [this.a, this.b] = [this.b, this.a];
    draw(this.show, out, T.sw, T.sh, u => { F.set(u); bindTex(3, this.a.t); gl.uniform1i(u.uState, 3); });
  } });
}

// 61_ink.js

// ───────────────────────── Ink in Water: ink entering a lit tank from every side, unfurling and lingering ─────────────────────────
{
const INK_W = stage.constrained ? 128 : 256, INK_H = stage.constrained ? 80 : 160, INK_DW = stage.constrained ? 512 : 1024, INK_DH = stage.constrained ? 320 : 640;
// Each kick lets ink in somewhere new: dropped from above, pushed in from a side wall, rising from the floor,
// or bled into the middle. uDropP is where and which ink; uDropV is the push it arrives with and how it spreads.
const INK_COMMON = `
in vec2 uv; out vec4 o; uniform sampler2D uVel, uDye; uniform float uDt, uAsp; uniform float uJetAge[8]; uniform vec4 uDropP[8], uDropV[8];
float land(float a){ return exp(-a*24.); }
vec3 inkOf(float k){ k = mod(k, 3.); return clamp(vec3(max(1.-abs(k), 1.-abs(k-3.)), 1.-abs(k-1.), 1.-abs(k-2.)), 0., 1.); }`;
const FS_INK_FORCE = HEAD + LIB + INK_COMMON + `
void main(){
  vec2 v = texture(uVel, uv).xy; float den = dot(texture(uDye, uv).rgb, vec3(1.));
  v.y -= den*.05*uDt;                                                       // ink is only a little heavier than water, so it hangs
  for (int i = 0; i < 8; i++){ float a = uJetAge[i]; if (a > .17) continue; vec2 d = (uv-uDropP[i].xy)*vec2(uAsp, 1.); float g = exp(-dot(d,d)/.0045);
    v += (uDropV[i].xy+uDropV[i].z*d/(length(d)+.02))*g*land(a)*uDt*(15.+16.*uDropV[i].w); }
  vec2 p = uv*vec2(uAsp, 1.); float t = uTime*.07;
  v += vec2(cos(p.y*2.3+t)+.5*cos(p.y*5.1-t*1.7), sin(p.x*1.9-t*1.3)+.5*sin(p.x*4.3+t*2.1))*uDt*.01*(.3+1.2*uMidS);   // the mids stir the tank, gently
  o = vec4(v, 0., 1.);
}`;
const FS_INK_DYE = HEAD + LIB + INK_COMMON + `
void main(){
  vec3 dye = texture(uDye, uv).rgb*exp(-uDt*.075);                          // it thins out only over a minute or more, so colours build up in layers
  for (int i = 0; i < 8; i++){ float a = uJetAge[i]; if (a > .17) continue; vec2 d = (uv-uDropP[i].xy)*vec2(uAsp, 1.);
    vec2 dir=normalize(uDropV[i].xy), per=vec2(-dir.y,dir.x);
    float along=dot(d,dir), across=dot(d,per);
    float tendril=sin(along*75.+uDropP[i].z)*.010;
    float w=.008+.010*uDropV[i].w;
    float plume=exp(-pow(along/.061,2.)-pow((across-tendril)/w,2.));
    plume+=.56*exp(-pow((along-.021)/.05,2.)-pow((across+tendril*2.)/(w*.66),2.));
    dye+=inkOf(uDropP[i].w)*plume*land(a)*uDt*(24.+28.*uDropV[i].w); }
  o = vec4(min(dye, vec3(3.2)), 1.);
}`;
const FS_INK = FSH + COVER + `
out vec4 o; uniform sampler2D uDye; const vec2 TX = 1./vec2(${INK_DW}., ${INK_DH}.);
void main(){
  vec2 sc = gl_FragCoord.xy/uRes, uv = cover(sc, 1.6), q = sc-.5;
  vec3 dye = texture(uDye, uv).rgb;
  vec3 gx = texture(uDye, uv+vec2(TX.x*2.,0.)).rgb-texture(uDye, uv-vec2(TX.x*2.,0.)).rgb, gy = texture(uDye, uv+vec2(0.,TX.y*2.)).rgb-texture(uDye, uv-vec2(0.,TX.y*2.)).rgb;
  vec2 g = vec2(dot(gx, vec3(1.)), dot(gy, vec3(1.)));
  // a tank lit from behind: soft, slightly cool light, brighter in the middle
  vec3 bg = mix(vec3(.74,.79,.84), vec3(.93,.94,.95), exp(-dot(q,q)*2.6))*(.82+.1*uLevelS);
  bg *= 1.+.05*sin(uv.y*40.+uTime+noise(vec3(uv*6., uTime*.2))*6.)*smoothstep(.75, 1., uv.y);       // light playing just under the surface
  vec3 c0 = mix(vec3(.05,.1,.45), neon(.0), .1), c1 = mix(vec3(.74,.05,.3), neon(.33), .1), c2 = mix(vec3(.0,.47,.5), neon(.66), .1);
  vec3 T = exp(-(dye.r*-log(max(c0, .03))+dye.g*-log(max(c1, .03))+dye.b*-log(max(c2, .03)))*1.05);
  // Narrow bands pick out existing filaments, leaving the pale water undisturbed.
  float pitch=clamp(.10+.78*uv.y+.06*sin(uv.x*16.),0.,1.);
  float edge=clamp(length(g)*2.+dot(dye,vec3(.08)),0.,1.);
  float lift=clamp(spec(pitch)-specS(pitch),0.,.55);
  vec3 col=bg*T+edge*lift*mix(vec3(.22,.36,.64),vec3(.53,.13,.24),uv.y);
  col *= 1.+clamp(dot(g, vec2(.5, .8))*.35, -.25, .3);                       // the plumes have body: lit on one side, shaded on the other
  col *= 1.-smoothstep(.985, 1., uv.y)*.25;                                  // the waterline
  o = vec4(col*(1.-.55*dot(q,q)), 1.);
}`;
scene({ id: 'ink', name: 'Ink in Water', from: 'Organic', kind: 'fluid', group: 'organic', pal: 0, hue: () => 0,
  about: 'A lit tank: a bass jet rises in the centre, snares enter from the right and pitched notes from the left; it unfurls slowly in a real fluid simulation and lingers, so the colours build up in layers',
  inputs: ['bassS', 'midS', 'levelS', 'pulse'],
  cost: 'Moderate: a 256×160 fluid solve (18 pressure iterations) and a 1024×640 dye field. Phones: 128×80 with 10 iterations and a 512×320 dye field.',
  post: { bloom: 0.06, thr: 1.6, exp: 1.0, ca: 0.15, vig: 0.3, grain: 0.02, pulse: 0 },
  init() { this.force = program(VS, FS_INK_FORCE); this.dye = program(VS, FS_INK_DYE); this.show = program(VS, FS_INK);
    this.fluid = new Fluid(INK_W, INK_H, INK_DW, INK_DH); this.P = new Float32Array(32); this.V = new Float32Array(32); this.last = new Float32Array(8).fill(9); this.n = 0; this.age = new Float32Array(8).fill(9); this.sn = A.snares; this.nn = A.notes; this.noteAt = -1; this.beat=A.beat; },
  draw(F, out) {
    // Repeated hits feed the same plume. A listener can follow each instrument in one place.
    for (let j = 0; j < 8; j++) this.age[j] += F.dt;
    const jet = (x, y, dx, dy, dye, strength) => {
      const i = this.n++ % 8;
      this.age[i] = 0;
      this.P.set([x, y, this.n*2.4, dye], i * 4);
      this.V.set([dx, dy, 0.12, strength], i * 4);
    };
    if(this.beat!==A.beat){ this.beat=A.beat; jet(.5+.16*Math.sin(A.beat*2.4), .35+.08*Math.cos(A.beat*2.4), .65*Math.sin(A.beat*2.4), 1.05, 0, Math.min(1, A.kickAmp / 2.5)); }
    if (this.sn !== A.snares) {
      this.sn = A.snares;
      jet(.68, .55+.12*Math.cos(A.snares*2.4), -.8, -.32, 1, .67);
    }
    if (this.nn !== A.notes) {
      this.nn = A.notes;
      if (F.time - this.noteAt > .28 && A.noteAmp > .36) {
        this.noteAt = F.time;
        jet(.31, .45 + .22 * A.noteBand, .75, .24, 2, A.noteAmp * .72);
      }
    }
    this.fluid.step(F.dt, { force: this.force, dye: this.dye, set: u => { F.set(u); gl.uniform1fv(u.uJetAge, this.age); gl.uniform4fv(u.uDropP, this.P); gl.uniform4fv(u.uDropV, this.V); }, keepV: 0.970, vort: 5, iters: 18, wall: 0.03 });
    draw(this.show, out, T.sw, T.sh, u => { F.set(u); bindTex(3, this.fluid.d[0].t); gl.uniform1i(u.uDye, 3); });
  } });
}

// 62_incense.js

// ───────────────────────── Incense: a thread of smoke rising from an ember, combed by the music ─────────────────────────
{
const SMK_W = stage.constrained ? 128 : 256, SMK_H = stage.constrained ? 80 : 160, SMK_DW = stage.constrained ? 512 : 1024, SMK_DH = stage.constrained ? 320 : 640;
const SMK_COMMON = `
in vec2 uv; out vec4 o; uniform sampler2D uVel, uDye; uniform float uDt, uAsp; uniform vec3 uTip; uniform float uSide[8];`;
const FS_SMK_FORCE = HEAD + LIB + SMK_COMMON + `
void main(){
  vec2 v = texture(uVel, uv).xy; float den = texture(uDye, uv).r;
  v.y += den*(.45+.85*uBassS)*uDt;                                           // warm smoke rises, faster when the bass is full
  vec2 d = (uv-uTip.xy)*vec2(uAsp, 1.);
  v += vec2(0., 1.)*exp(-dot(d,d)/.0004)*uDt*(4.5+2.5*uLevelS);
  for (int i = 0; i < 8; i++){ float a = uPulse[i]; if (a > .9) continue;       // each kick: a breath of air across the column
    float front=uv.y-.27-a*.95;
    float gust=exp(-front*front/.043)*exp(-a*4.);
    v.x+=uSide[i]*gust*uDt*2.85;
    v.y+=uSide[i]*gust*(uv.x-.47)*uDt*.80; }
  vec2 p = uv*vec2(uAsp, 1.); float t = uTime*.2;
  v += vec2(sin(p.y*4.+t)+.6*sin(p.y*9.-t*1.6), 0.)*uDt*.02*(.3+1.5*uHighS)*smoothstep(.2,.5,uv.y);   // the room's own small draughts
  v.x += uDt*(sin(uv.y*15.+t)*uSnare*.92 + sin(uv.y*24.-t)*uHigh*.23)*smoothstep(.20,.68,uv.y);
  float height = smoothstep(.16,.75,uv.y);
  v.x += (tanh((uv.x-uTip.x)*16.)*.33 + sin(uv.y*11.-t)*.14)*height*uDt*min(den,1.);
  o = vec4(v, 0., 1.);
}`;
const FS_SMK_DYE = HEAD + LIB + SMK_COMMON + `
void main(){
  vec3 s = texture(uDye, uv).rgb; s.r *= exp(-uDt*.09); s.g *= exp(-uDt*1.1);     // r: smoke, g: its heat near the ember
  vec2 d = (uv-uTip.xy)*vec2(uAsp, 1.); float g = exp(-dot(d,d)/.00009);
  s.r += g*uDt*(9.+10.*uLevelS+10.*uKick+12.*uAccent); s.g += g*uDt*14.;
  s.r *= 1.-uDt*2.*smoothstep(.9, 1., uv.y);
  o = vec4(min(s, vec3(4.)), 1.);
}`;
const FS_SMK = FSH + COVER + `
out vec4 o; uniform sampler2D uDye; uniform vec2 uLight; uniform vec3 uTip; const vec2 TX = 1./vec2(${SMK_DW}., ${SMK_DH}.);
void main(){
  vec2 sc = gl_FragCoord.xy/uRes, uv = cover(sc, 1.6), q = sc-.5, p = uv*vec2(1.6, 1.);
  vec3 s = texture(uDye, uv).rgb;
  vec2 g = vec2(texture(uDye, uv+vec2(TX.x*2.5,0.)).r-texture(uDye, uv-vec2(TX.x*2.5,0.)).r, texture(uDye, uv+vec2(0.,TX.y*2.5)).r-texture(uDye, uv-vec2(0.,TX.y*2.5)).r);
  // a dark room: a little warm light low down, and one cool lamp off to the right
  vec3 col = vec3(.006,.005,.006)+vec3(.05,.03,.018)*exp(-pow((uv.y-.05)/.3, 2.))*(.4+.3*uBassS)*exp(-pow(q.x/.5, 2.));
  col += mix(vec3(.02,.03,.05), neon(.62)*.04, .4)*exp(-length((sc-vec2(.95,.75))*vec2(1.6,1.))*2.4);
  float a = 1.-exp(-s.r*2.2);
  float lit = clamp(.5-dot(g, normalize(vec2(1., .35)))*1.1, 0., 1.);        // lit from the right: each fold of smoke has a bright and a dark side
  vec3 sm = mix(mix(vec3(.3,.34,.42), neon(.62)*.4, .25), mix(vec3(.9,.94,1.), neon(.55), .15), lit)*(.5+.5*uLevelS+.35*uKick);
  float band=clamp((uv.y-uTip.y)*1.16,.04,.94);
  float pitch=spec(band), transient=max(0.,pitch-specS(band));
  sm+=vec3(.32,.38,.48)*(.26*pitch+1.35*transient)*(.4+.6*lit);
  // The light catches folds at treble and midrange attacks without pushing the smoke sideways.
  float foldLight=clamp(.23+3.*length(g),0.,1.);
  sm+=foldLight*(vec3(.25,.33,.48)*uLight.y+vec3(.38,.22,.12)*uLight.x);
  sm = mix(sm, vec3(1.,.55,.25)*1.4, clamp(s.g*.5, 0., 1.));                 // near the ember the smoke glows warm
  col = mix(col, sm, a*.85);
  // the stick and its ember
  vec2 tp = uTip.xy*vec2(1.6, 1.), base = tp+vec2(.42, -.5), ab = base-tp, pa = p-tp; float h = clamp(dot(pa,ab)/dot(ab,ab), 0., 1.), ds = length(pa-ab*h);
  col = mix(col, vec3(.1,.065,.045)*(.5+2.5*exp(-h*10.)), smoothstep(.0035, .002, ds));
  float de = length(p-tp);
  col += vec3(1.,.42,.12)*(smoothstep(.007,.003,de)*(4.+6.*uBass+8.*uKickL)+exp(-de*42.)*(.25+.5*uBass+.6*uKick));
  o = vec4(col*(1.-.6*dot(q,q)), 1.);
}`;
scene({ id: 'incense', name: 'Incense', from: 'Organic', kind: 'fluid', group: 'organic', pal: 0, hue: () => 0,
  about: 'A thread of smoke rising from an ember in a dark room: bass makes it climb, each kick breathes across it, and it folds and breaks in a real fluid simulation',
  inputs: ['bassS', 'levelS', 'highS', 'bass', 'kick', 'kickL', 'accent', 'pulse', 'notes (onsets)'],
  cost: 'Moderate: a 256×160 fluid solve (18 pressure iterations) and a 1024×640 smoke field. Phones: 128×80 with 10 iterations.',
  post: { bloom: 0.5, thr: 0.9, knee: 0.6, exp: 1.1, ca: 0.25, vig: 0.6, grain: 0.03 },
  init() { this.force = program(VS, FS_SMK_FORCE); this.dye = program(VS, FS_SMK_DYE); this.show = program(VS, FS_SMK);
    this.fluid = new Fluid(SMK_W, SMK_H, SMK_DW, SMK_DH); this.side = new Float32Array(8); this.last = new Float32Array(8).fill(9); this.flip = 1; this.nn = A.notes; this.kink = 0; this.wob = 0; },
  draw(F, out) {
    const t = F.time;
    const tip = [.47, .13, 0];
    newPulses(this.last, i => { this.flip = -this.flip; this.side[i] = this.flip * (.55 + .8*Math.min(1,A.kickAmp/3)); });
    const set = u => { F.set(u); gl.uniform3fv(u.uTip, tip); gl.uniform1fv(u.uSide, this.side); };
    this.fluid.step(F.dt, { force: this.force, dye: this.dye, set, keepV: 0.979, vort: 2.5 + 5 * A.highS, iters: 18, wall: 0 });
    let mids=0,highs=0;
    for(let i=90;i<256;i++){
      const attack=Math.max(0,A.bands[i]-A.bandsS[i]);
      if(i<173)mids=Math.max(mids,attack);else highs=Math.max(highs,attack);
    }
    draw(this.show, out, T.sw, T.sh, u => { set(u); gl.uniform2f(u.uLight,3*mids,4*highs); bindTex(3, this.fluid.d[0].t); gl.uniform1i(u.uDye, 3); });
  } });
}

// 63_leaves.js

// ───────────────────────── Falling Leaves: autumn leaves tumbling through low sun, carried by gusts ─────────────────────────
{
const LEAF_N = 800;
const LEAF_BG = `
vec3 autumn(float t){ return vec3(.7,.36,.1)+vec3(.28,.27,.07)*cos(TAU*(t*vec3(.8,.9,1.)+vec3(0.,.1,.2))); }      // gold, through orange and red, to brown
const vec3 LSUN = vec3(.44, .5, .745);                                           // the sun is ahead and above: the leaves are lit from behind
vec3 sunC(){ return mix(vec3(1.,.74,.42), neon(.1), .12)*(.85+.3*uBassS+.5*uKick+.4*uDrop); }`;
const VS_LEAF = VSP + LEAF_BG + `
uniform float uFall, uWind;
out vec2 vUV; out vec3 vN, vT, vW; out vec3 vH; out float vDepth;
void main(){
  uint id = uint(gl_InstanceID)*7u;
  float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), h4 = hashu(id+3u), h5 = hashu(id+4u), h6 = hashu(id+5u), h7 = hashu(id+6u);
  const vec3 BOX = vec3(22., 13., 13.);                                          // larger than the view at every depth, so a leaf only ever wraps out of sight
  float sp = .6+.8*h4, ph = uFall*sp+uWind*.35+h5*40.;                           // its own weight, and its own clock, wound by the fall and the wind
  float sway = sin(ph*1.7+h6*6.)*.5+sin(ph*.9+h1*9.)*.35;
  vec3 c = vec3(mod(h1*BOX.x+uWind*(h3-.48)*1.8+sway+1.45*sin(ph*.57+h3*7.), BOX.x)-BOX.x*.5, mod(h2*BOX.y-uFall*sp+.55*sin(ph*.85+h1*6.), BOX.y)-BOX.y*.5, h3*h3*BOX.z+1.4+.55*sin(ph*.42+h7*8.));
  float a1 = ph*2.1+h7*6.28, a2 = ph*1.3+h1*6.28+sway*.8, a3 = h3*6.28+sin(ph*.7)*.6;                      // tumbling
  float c1 = cos(a1), s1 = sin(a1), c2 = cos(a2), s2 = sin(a2), c3 = cos(a3), s3 = sin(a3);
  mat3 R = mat3(c3,s3,0., -s3,c3,0., 0.,0.,1.)*mat3(c2,0.,-s2, 0.,1.,0., s2,0.,c2)*mat3(1.,0.,0., 0.,c1,s1, 0.,-s1,c1);
  vec2 q = vec2(float(gl_VertexID == 1 || gl_VertexID == 2 || gl_VertexID == 4), float(gl_VertexID == 2 || gl_VertexID == 4 || gl_VertexID == 5));
  float sz = .26+.34*h4*h4;
  vW = c+R*vec3((q.x-.5)*sz*.82, (q.y-.5)*sz*1.3, 0.); vN = R[2]; vT = R[0]; vUV = q; vH = vec3(h6, h7, h5);
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_LEAF = FSH + LEAF_BG + `
in vec2 vUV; in vec3 vN, vT, vW; in vec3 vH; in float vDepth; out vec4 o;
void main(){
  vec2 p = vUV*2.-1.; float yy = vUV.y, lobed = step(.6, vH.x);
  // the outline: a pointed oval, toothed, and for some leaves lobed; a stalk at the foot
  float w = sin(PI*pow(clamp((yy-.1)/.9, 0., 1.), .75))*(1.-.4*yy)*.88;
  w *= 1.+lobed*.22*sin(yy*PI*5.5)+.035*sin(yy*70.);
  float d = abs(p.x)-w, stalk = step(yy, .14)*step(abs(p.x), .035);
  if (d > 0. && stalk < .5) discard;
  float rib = smoothstep(.05, .012, abs(p.x)), vv = fract(yy*7.5-abs(p.x)*2.4), veins = max(rib, smoothstep(.1, 0., abs(vv-.5))*smoothstep(0., -.15, d)*.7);
  vec3 n = normalize(vN+vT*p.x*.7*(vH.z-.3)); if (!gl_FrontFacing) n = -n;            // the blade is cupped
  vec3 V = normalize(uEye-vW), sc = sunC();
  float ndl = dot(n, LSUN), lit = max(ndl, 0.), thru = max(-ndl, 0.);
  vec3 base = mix(autumn(vH.y*.75), neon(vH.y), .1)*(.75+.5*noise(vec3(vUV*5., vH.x*20.)));
  base *= 1.-.5*smoothstep(.55,.8, noise(vec3(vUV*9., vH.y*30.)));                   // blemishes
  base *= .8+.2*smoothstep(0., -.2, d);                                             // a darker, drier edge
  vec3 col = base*(.07+.5*lit*sc);
  col += pow(base, vec3(.7))*sc*thru*1.5*(1.-.5*veins);                              // sunlight coming through the leaf; the veins show dark against it
  col += sc*pow(max(dot(reflect(-LSUN, n), V), 0.), 24.)*.3*lit;
  col *= 1.-.25*veins*lit;
  o = vec4(col*exp(-vDepth*.02), vDepth);
}`;
const FS_LEAF_BG = FSH + LEAF_BG + `
out vec4 o;
float bokeh(vec2 q, float sc, float seed){ vec2 g = q*sc, c = floor(g); float s = 0.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 cc = c+vec2(float(i), float(j)); float h = hash2(cc+seed);
    if (h < .55) continue; vec2 ctr = cc+.5+.6*(vec2(hash2(cc+seed+3.), hash2(cc+seed+7.))-.5); float r = .22+.3*hash2(cc+seed+11.), dd = length(g-ctr)/r;
    s += (smoothstep(1., .9, dd)*(.55+.45*smoothstep(.6, .95, dd)))*(h-.55)*2.2*(.55+.45*sin(uTime*(.6+h*1.5)+h*40.)); }
  return s; }
void main(){
  vec2 q = (gl_FragCoord.xy*2.-uRes)/uRes.y, sp = vec2(1.05, .78); float ds = length(q-sp);
  vec3 sc = sunC();
  // an out-of-focus wood: dark trunks, warm light pouring in from the upper right
  vec3 col = mix(vec3(.008,.012,.006), vec3(.05,.036,.012), smoothstep(-1., 1., q.y+q.x*.4));
  col += sc*(exp(-ds*1.8)*.16+exp(-ds*5.)*.6);
  float trunks = smoothstep(.5,.72, noise(vec3(q.x*1.6+3., q.y*.08, 1.)))*.75+smoothstep(.6,.8, noise(vec3(q.x*4.1+9., q.y*.1, 4.)))*.4;
  col *= 1.-clamp(trunks, 0., .85)*(1.-exp(-ds*1.2)*.7);
  // shafts of light between the trunks; each one is a band
  float ang = atan(q.y-sp.y, q.x-sp.x), band = fract(ang/PI*2.+.5), shaft = pow(noise(vec3(ang*7., uTime*.07, 2.)), 2.);
  col += sc*shaft*(.25+2.6*spec(.05+band*.6))*exp(-ds*1.1)*.1*smoothstep(.15,.6,ds);
  col += (sc*.6+autumn(.1)*.4)*bokeh(q, 2.6, 1.)*.07*(.6+1.2*uHigh)+autumn(.3)*bokeh(q+3., 4.6, 9.)*.05*(.6+1.2*uHigh);
  o = vec4(col, 60.);
}`;
scene({ id: 'leaves', name: 'Falling Leaves', from: 'Organic', kind: 'nature', group: 'organic', pal: 3, hue: () => 0,
  about: 'Autumn leaves tumbling through low sun in an out-of-focus wood: the bass is the wind, every kick is a gust, the light swells with the music, and a big moment lifts them all',
  inputs: ['spec', 'bassS', 'levelS', 'high', 'kick', 'dyn', 'drop'],
  cost: 'Light geometry (1,100 quads); depth of field is most of the cost. Phones: 400 leaves and a 12-tap blur.',
  post: { dof: { ap: 9, max: 12 }, bloom: 0.5, thr: 0.95, knee: 0.7, spread: 0.72, exp: 1.05, ca: 0.3, vig: 0.75, pulse: 0.4 },
  init() { this.bg = program(VS, FS_LEAF_BG); this.leaf = program(VS_LEAF, FS_LEAF); this.fall = 0; this.wind = 0; },
  draw(F, out) {
    const t = F.time;
    this.fall += F.dt * (0.35 + 0.6 * A.levelS + 0.35 * A.dyn - 0.55 * A.accent - 1.3 * A.drop);   // strong beats hold them up a moment          // a big moment lifts them
    this.wind += F.dt * ((0.35 + 1.6 * A.bassS + 3.4 * A.kick + 2.2 * A.accent) * Math.sin(t * 0.21 + 0.8));                          // every kick is a gust
    const c = camera([Math.sin(t * 0.07) * 0.3, Math.sin(t * 0.05) * 0.2, 0], [0, 0.35, 10], 0.75, Math.sin(t * 0.06) * 0.03, 0.2, 80);
    const set = u => { F.set(u); setCam(u, c); gl.uniform1f(u.uFall, this.fall % 100000); gl.uniform1f(u.uWind, this.wind % 100000); };
    F.focus = 6;
    beginMS(); quad(this.bg, set);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(this.leaf.p); set(this.leaf.u); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, LEAF_N);
    endMS(out);
  } });
}

// 64_wheat.js

// ───────────────────────── Wind in the Wheat: a field at golden hour, combed by gusts that arrive on the beat ─────────────────────────
{
const WHEAT_N = stage.constrained ? 18000 : 72000;
const WHEAT_FN = `
uniform vec2 uWdir; uniform float uChaff;
float voice(float band){
  float fast=spec(band);
  return clamp(.45*fast+3.8*max(0.,fast-specS(band)),0.,1.);
}

const vec3 WSUN = vec3(-.33, .2, .922);
vec3 wsunC(){ return mix(vec3(1.,.66,.3), neon(.1), .12)*(.85+.3*uBassS+.12*uKick+.25*uAccent); }
vec3 wheatSky(vec3 rd){
  float y = max(rd.y, 0.), a = acos(clamp(dot(rd, WSUN), -1., 1.)); vec3 sc = wsunC();
  vec3 col = mix(mix(vec3(1.,.55,.2), neon(.05), .12), vec3(.5,.42,.4), smoothstep(0.,.14,y));
  col = mix(col, mix(vec3(.2,.3,.46), neon(.62), .12), smoothstep(.08,.5,y));
  col *= mix(.4, 1., exp(-a*1.3))*.4;
  col += sc*(smoothstep(.05,.042,a)*12.+exp(-a*11.)*.7+exp(-a*3.5)*.12);
  vec2 cp = rd.xz/(rd.y+.12); float cl = smoothstep(.5,.8, fbm(vec3(cp.x*.35+uTime*.006, cp.y*.9, 3.)))*exp(-y*2.5)*smoothstep(0.,.04,rd.y);
  col = mix(col, mix(vec3(.3,.2,.25), sc*.9, exp(-a*1.5)), cl*.6);
  float az = atan(rd.x, rd.z), tl = .008+.016*noise(vec3(az*9., 2., 5.))+.012*noise(vec3(az*31., 7., 5.))+.007*noise(vec3(az*110., 3., 5.));       // a far line of trees
  col = mix(col, mix(vec3(.05,.055,.045), col, .55), smoothstep(tl+.005, tl-.005, rd.y));
  return col; }
// how hard the wind leans on the stalks at xz: gust fronts cross the field in step with the music
float gust(vec2 xz){
  // Furrows carry distinct frequency bands; the delayed spectrum travels away along the row.
  float row=floor(xz.x*.82+sin(xz.y*.17)*.63);
  float pitch=.035+.89*fract(row*.618034+.19);
  float attack=voice(pitch), memory=hist(pitch,clamp((xz.y-1.)*.011,0.,.58));
  float side=sin(row*2.4+.65*xz.y);
  float bassFront=uKickL*exp(-pow((xz.y-3.)/4.,2.))*(.5+.5*cos(row*2.2));
  return .035*sin(xz.x*.6-uTime*.68)+side*(.72*attack+.26*memory)+.64*bassFront; }`;
const VS_WHEAT = VSP + WHEAT_FN + `
out vec3 vW; out vec4 vI; out float vDepth;
const float TT[6] = float[6](0., .36, .64, .76, .88, 1.), WW[6] = float[6](1., .9, .8, 2.7, 2.3, .0);
void main(){
  uint id = uint(gl_InstanceID)*5u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), h4 = hashu(id+3u), h5 = hashu(id+4u);
  float bz = 1.3+pow(h2, 1.7)*58.; vec2 base = vec2((h1-.5)*(26.+bz*1.3), bz);          // thinning toward the horizon, where a stalk is less than a pixel                           // the field in front of you
  float hgt = .95+.3*h3, B = clamp(gust(base)*(.75+.5*h4)+.065*sin(uTime*.8+h5*6.28),-.95,.95);        // the bend at the tip, in radians
  vec2 dir=normalize(uWdir+vec2(.23*sin(base.y),.95*sin(base.x*.83+h3)));
  int seg = gl_VertexID/6, k = gl_VertexID%6, end = (k == 1 || k == 2 || k == 4) ? 1 : 0; float side = (k == 2 || k == 4 || k == 5) ? 1. : -1.;
  float t = TT[seg+end], w = WW[seg+end]*.0036*(.8+.5*h3);
  float off = hgt*.5*B*t*t*(1.-B*B*t*t/12.), up = hgt*t*(1.-B*B*t*t/6.);                         // a stalk bent into an arc keeps its length
  vec3 p = vec3(base.x+dir.x*off, up, base.y+dir.y*off);
  vec3 tang = normalize(vec3(dir.x*sin(B*t), cos(B*t), dir.y*sin(B*t))), sd = normalize(cross(tang, p-uEye));
  vW = p+sd*side*w; vI = vec4(t, B, .035+.89*fract(floor(base.x*.82+sin(base.y*.17)*.63)*.618034+.19), h5);
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_WHEAT = FSH + WHEAT_FN + `
in vec3 vW; in vec4 vI; in float vDepth; out vec4 o;
void main(){
  float t = vI.x, ear = smoothstep(.62,.7,t); vec3 V = normalize(vW-uEye), sc = wsunC();
  vec3 base = mix(mix(vec3(.2,.24,.06), vec3(.62,.44,.13), smoothstep(.1,.7,t)), vec3(1.,.72,.28), ear)*(.45+.9*vI.w);
  base = mix(base, neon(.1+vI.w*.2)*dot(base, vec3(.4)), .1);
  float toSun = pow(max(dot(V, WSUN), 0.), 2.);
  vec3 col = base*(.035+.09*smoothstep(0.,.6,t));                             // sky light, less of it down among the stalks
  col += base*sc*(.08+.5*toSun)*smoothstep(.05,.7,t)*(.45+.55*ear);           // the low sun through them
  col += sc*base*abs(vI.y)*.3*smoothstep(.3,.9,t);                                // stalks leaning over show their flat side: gusts run through the field as light
  col+=ear*vec3(.71,.38,.085)*voice(vI.z)*(.25+.75*vI.w);
  col *= smoothstep(-.1,.35,t);
  float dist = length(vW-uEye);
  col = mix(col, wheatSky(normalize(vec3(V.x, .03, V.z)))*.5, 1.-exp(-dist*.028));
  o = vec4(col, vDepth);
}`;
const FS_WHEAT_SKY = FSH + WHEAT_FN + `
out vec4 o; void main(){ vec3 rd = viewRay(); vec3 col = wheatSky(rd); float depth = 300.;
  if (rd.y < 0.){ float t = -uEye.y/rd.y; depth = t; col = mix(vec3(.2,.14,.04)*wsunC(), wheatSky(normalize(vec3(rd.x,.03,rd.z)))*.5, 1.-exp(-t*.028)); }
  o = vec4(col, depth); }`;
const VS_MOTE = VSP + WHEAT_FN + `
uniform float uDpr, uFocus, uWindT; out vec3 vCol;
void main(){ uint id = uint(gl_VertexID)*4u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), h4 = hashu(id+3u);
  vec3 p = vec3(mod(h1*26.+uWindT*(.5+.6*h4)*uWdir.x, 26.)-13., .7+h2*2.6+.25*sin(uTime*(.3+h4)+h3*20.), mod(h3*18.+uWindT*(.5+.6*h4)*uWdir.y, 18.)+.6);
  p.y+=.53*voice(.30+.65*h2)*(.3+h4)+.32*sin(uChaff*(.8+h2)+h3*6.28);
  p.x+=.6*cos(uChaff+h3*6.28);
  gl_Position = uVP*vec4(p,1.); float d = max(gl_Position.w, .05), size = max(1.6, abs(d-uFocus)/d*9.)*uDpr; gl_PointSize = min(size, 30.);
  float edge = smoothstep(0., 1.5, 13.-abs(p.x))*smoothstep(.6, 2., p.z)*smoothstep(18.6, 16., p.z);
  vCol = wsunC()*(.5+1.5*step(.9, h4))*(.15+2.8*voice(.30+.65*h2)+.8*uSnare)*edge*(2.2/(size*size))*(.6+.4*sin(uTime*(1.+h1*3.)+h2*40.)); }`;
scene({ id: 'wheat', name: 'Wind in the Wheat', from: 'Organic', kind: 'nature', group: 'organic', pal: 3, hue: () => 0,
  about: 'A wheat field at golden hour: every strong beat sends a slow gust that rolls through 72,000 stalks as waves of light, seeds drift in the low sun, and the near ears blur past the lens',
  inputs: ['slow history (dyn, accent, slow bass, slow level)', 'bassS', 'high', 'kick', 'accent'],
  cost: 'Vertex-heavy: 72,000 stalks (2.2 M vertices) with a wind lookup each, plus depth of field. Phones: 16,000 stalks and no depth of field. TVs: 32,000.',
  post: { dof: { ap: 3, max: 9 }, bloom: 0.55, thr: 0.95, knee: 0.7, spread: 0.74, exp: 1.0, ca: 0.3, vig: 0.7, pulse: 0.15 },
  init() { this.sky = program(VS, FS_WHEAT_SKY); this.blade = program(VS_WHEAT, FS_WHEAT); this.mote = program(VS_MOTE, FS_POINT); this.windT = 0; this.chaff = 0; },
  draw(F, out) {
    const t = F.time, wa = 0.25 + Math.sin(t * 0.02) * 0.2, wd = [Math.cos(wa), -Math.sin(wa)];
    this.chaff+=F.dt*(.18+2.8*A.snare+.6*A.high);
    this.windT += F.dt * (0.35 + 0.9 * A.bassVS + 0.6 * A.accent);
    const eye = [Math.sin(t * 0.025) * 0.35, 1.62, 0];                              // the camera stands still in the field
    const c = camera(eye, [eye[0] * 0.5, 1.2, 8], 0.8, 0, 0.1, 400), focus = 4.5;
    const set = u => { F.set(u); setCam(u, c); gl.uniform2fv(u.uWdir, wd); gl.uniform1f(u.uChaff,this.chaff); };
    F.focus = focus;
    beginMS(); quad(this.sky, set);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(this.blade.p); set(this.blade.u); gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, WHEAT_N);
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    points(this.mote, 5000, u => { set(u); gl.uniform1f(u.uDpr, F.px); gl.uniform1f(u.uFocus, focus); gl.uniform1f(u.uWindT, this.windT % 100000); });
    endMS(out);
  } });
}

// 65_shallows.js

// ───────────────────────── Shallows: sunlight through moving water onto sand and stones ─────────────────────────
{
// One full-screen pass. The water surface is a sum of small waves plus the rings left by falling drops: a big
// drop on every kick, a middling one on every snare, and a small one for each note (placed across the pool by
// its pitch). A drop falls, strikes, throws up a bead that falls back and rings again. The
// light pattern on the bed is the focusing of the sun by that surface (how much a patch of light is squeezed
// or spread, from the second derivatives of the surface), slightly different for red, green and blue.
const FS_SHALLOWS = FSH + `
out vec4 o; uniform vec4 uDr[14];                              // each drop: x, z, size, age in seconds
float voice(float band){
  float fast=spec(band);
  return clamp(.45*fast+3.8*max(0.,fast-specS(band)),0.,1.);
}
const float FALL = .035, BACK = .5;                             // it strikes FALL after it is let go; the bead it throws up lands BACK after that
vec2 wgrad(vec2 p){                                           // the slope of the water surface at p
  vec2 g = vec2(0.); float warp = noise(vec3(p*.35, uTime*.12))*5., amp = .10+.34*uBassS;
  for (int i = 0; i < 9; i++){ float fi = float(i), ang = fi*2.399+.6, k = 1.7*pow(1.32, fi); vec2 D = vec2(cos(ang), sin(ang));
    g += D*(.012+.033*amp+.077*voice(.035+fi*.111))*cos(k*dot(D,p)-sqrt(k*4.)*uTime*.62+warp*(.6+.2*fi)+fi*1.7); }
  for (int i = 0; i < 14; i++){ float sz = uDr[i].z, a = uDr[i].w-FALL, life = .44+.84*sz; if (sz <= 0. || a < 0. || a > life+BACK) continue;
    vec2 d = p-uDr[i].xy; float r = length(d)+1e-3, x = r-a*1.5, k = 22.-8.*sz;                          // bigger drops make broader, longer-lived rings
    float w = cos(x*k)*smoothstep(0.,.035,a)*(1.-smoothstep(life*.5, life, a))*exp(-x*x*(9.-4.*sz));
    float a2 = a-BACK, x2 = r-a2*1.5; if (a2 > 0.) w += .2*cos(x2*k)*smoothstep(0.,.12,a2)*(1.-smoothstep(life*.3, life*.7, a2))*exp(-x2*x2*9.);
    g += d/r*w*(.2+.5*sz)/(1.+r*.7); }
  return g; }
float petal(vec2 p, out vec3 pc){                              // a few petals riding the surface
  vec2 q = p+vec2(uTime*.05, uTime*.02), c = floor(q/1.7); float h = hash2(c+3.); pc = mix(vec3(1.,.82,.86), vec3(1.,.95,.8), hash2(c+9.));
  if (h < .62) return 0.;
  vec2 l = rot(h*20.+uTime*.1*(h-.8))*(q-(c+.3+.4*vec2(hash2(c+5.), hash2(c+7.)))*1.7);
  return smoothstep(.0, -.012, length(l*vec2(1., 1.9))-.07-.04*h); }
void main(){
  vec3 rd = viewRay(); const vec3 SUNL = vec3(.32, .86, .4);
  float ts = -uEye.y/rd.y; vec3 Ps = uEye+rd*ts; vec2 ps = Ps.xz;
  vec2 gs = wgrad(ps); vec3 n = normalize(vec3(-gs.x, 1., -gs.y));
  vec3 rr = refract(rd, n, 1./1.33);
  float depth = .55+.4*noise(vec3(ps*.16, 2.)), path = depth/max(-rr.y, .2); vec2 pf = ps+rr.xz*path;      // the point on the bed that you see
  // the bed: rippled sand, scattered stones
  float rip = sin(pf.x*7.+noise(vec3(pf*1.1, 4.))*5.+pf.y*1.5);
  vec3 sand = vec3(.78,.67,.48)*(.82+.1*rip+.14*noise(vec3(pf*42., 1.)))*(.9+.2*noise(vec3(pf*.7, 6.)));
  vec2 sg = pf*1.25, sc = floor(sg), sf = fract(sg); float stone = 0., shade = 1., rim=0.; vec3 stc = vec3(.4);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 cc = sc+vec2(float(i), float(j)); float h = hash2(cc+.7);
    if (h < .58) continue; vec2 ctr = cc+.25+.5*vec2(hash2(cc+1.3), hash2(cc+2.9)), d = (sg-ctr)*vec2(1., .8+.5*hash2(cc+4.)); float r = .15+.32*(h-.58)*2.2, dd = length(d)/r;
    if (dd < 1.){ stone = smoothstep(1., .9, dd); stc = mix(vec3(.42,.4,.38), vec3(.6,.48,.36), hash2(cc+6.))*(.75+.5*hash2(cc+8.));
      rim=dd*dd*stone; stc*=.65+.55*noise(vec3(pf*68.,h));
      shade = .48+.72*clamp(dot(normalize(vec3(-d/r, sqrt(max(1.-dd*dd, 0.)))), normalize(vec3(.4,.5,.8))), 0., 1.); }
    else shade = min(shade, mix(.6, 1., smoothstep(1., 1.5, length(d-vec2(.06,-.08))/r))); }               // and its shadow on the sand
  vec3 bed = mix(sand, stc, stone)*shade;
  // the light: where the surface focuses the sun, and where it spreads it
  const float e = .02; vec2 g0 = wgrad(pf), gx = wgrad(pf+vec2(e,0.)), gy = wgrad(pf+vec2(0.,e));
  float hxx = (gx.x-g0.x)/e, hxy = (gx.y-g0.y)/e, hyy = (gy.y-g0.y)/e, c = depth*.62;
  vec3 cc3 = c*vec3(.94, 1., 1.07), det = (1.-cc3*hxx)*(1.-cc3*hyy)-cc3*cc3*hxy*hxy;
  vec3 caus = min(1./(abs(det)+.14), vec3(4.));
  vec3 pc; float pshadow = petal(pf-SUNL.xz*depth*.5, pc);
  vec3 sun=vec3(.22,.35,.61);
  vec3 col=bed*vec3(.024,.035,.069)+bed*sun*caus*.09*(1.-.6*pshadow);
  // Pools of light below the stones. Local falloff leaves pockets of deep water between them.
  vec2 cell=floor(pf/2.8);
  vec3 lanterns=vec3(0.);
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 c=cell+vec2(i,j); float seed=hash2(c+9.);
    vec2 pos=(c+.2+.6*vec2(hash2(c+2.),hash2(c+4.)))*2.8;
    vec2 delta=pf-pos; float r2=dot(delta,delta);
    vec3 lamp=seed<.4?vec3(.015,.83,.72):(seed<.72?vec3(.26,.16,.94):vec3(.95,.33,.085));
    float local=voice(.04+.91*seed);
    float strike=seed<.4?uKickL:(seed<.72?uMid:uSnare);
    float light=exp(-r2*(1.6+.7*seed))*(.075+2.7*local+1.95*strike*strike);
    lanterns+=lamp*light;
  }
  col+=lanterns*(.14+.52*caus)*(.36+stone*.58+rim*.99)*(.35+.78*shade)*(.83+.22*noise(vec3(pf*55.,2.)));
  // Glints share the rock bed's coordinates, so sound picks out individual grains through the water.
  vec2 grit=pf*13., tile=floor(grit);
  float pitch=hash2(tile+11.), energy=voice(.035+.92*pitch);
  vec2 spark=fract(grit)-vec2(.2+.6*hash2(tile),.2+.6*hash2(tile+3.));
  float glint=exp(-dot(spark,spark)*mix(76.,18.,energy));
  col+=mix(vec3(.07,.65,.57),vec3(.69,.32,.91),pitch)*glint*energy*energy*(.4+rim+clamp(caus.g,0.,2.));
  col*=exp(-vec3(.22,.095,.06)*path);
  vec3 rf=reflect(rd,n);
  float fr=.03+.85*pow(1.-max(dot(n,-rd),0.),5.);
  col=mix(col,vec3(.026,.049,.10)+vec3(.21,.31,.50)*pow(max(rf.y,0.),6.),fr);
  col+=vec3(.64,.80,1.)*pow(max(dot(rf,normalize(vec3(.28,.51,.81))),0.),180.)*.95;
  float pm=petal(ps+gs*.3,pc);
  col=mix(col,pc*(vec3(.12,.14,.19)+lanterns*.3),pm);
  // the drops themselves: a streak coming down, then the bead thrown back up
  for (int i = 0; i < 14; i++){ float sz = uDr[i].z, a = uDr[i].w; if (a > FALL+BACK || sz <= 0.) continue;
    float up = a < FALL ? (1.-a/FALL)*1.5 : sz*.42*4.*((a-FALL)/BACK)*(1.-(a-FALL)/BACK), rad = (a < FALL ? .028 : .02)*(.5+.8*sz), sy = a < FALL ? 4. : 1.2;
    vec3 C = vec3(uDr[i].x, up+rad, uDr[i].y), oc = (uEye-C)*vec3(1., 1./sy, 1.), dd = normalize(rd*vec3(1., 1./sy, 1.));
    float b = dot(oc, dd), h = b*b-dot(oc, oc)+rad*rad;
    if (h > 0.){ vec3 nn = normalize((oc+dd*(-b-sqrt(h)))*vec3(1., 1./sy, 1.)); float e = 1.-max(dot(nn, -rd), 0.);
      vec3 dc = mix(vec3(.5,.66,.82), vec3(.95,.98,1.), smoothstep(-.2,.8,nn.y))*(.21+.36*e)+lanterns*.35+sun*pow(max(dot(reflect(rd, nn), SUNL), 0.), 40.)*3.;
      col = mix(col, dc, smoothstep(0., rad*rad*.4, h)*.9); }
    float ai = a-FALL; if (ai > 0. && ai < .25){ float rr = length(ps-uDr[i].xy);                           // the crown at the moment it strikes
      col += sun*exp(-pow((rr-ai*.9)/.02, 2.))*(1.-ai/.25)*sz*1.2; } }
  o = vec4(col, ts+path);
}`;
scene({ id: 'shallows', name: 'Shallows', from: 'Organic', kind: 'nature', group: 'organic', pal: 0, hue: () => 0,
  about: 'Moonlit water and bass-triggered drops above stones underlit in turquoise, violet and amber',
  inputs: ['bassS', 'highS', 'levelS', 'high', 'kick', 'pulse', 'snares, notes (onsets)', 'dyn'],
  cost: 'Moderate: four surface-slope evaluations a pixel (about 70 trig calls). Phones: five waves instead of nine, at reduced resolution.',
  post: { dof: { ap: 4, max: 5 }, bloom: 0.35, thr: 1.1, knee: 0.6, exp: 1.0, ca: 0.3, vig: 0.6, pulse: 0.2 },
  init() { this.p = program(VS, FS_SHALLOWS); this.dr = new Float32Array(56); this.di = 0; this.last = new Float32Array(8).fill(9); this.beat = A.beat; },
  draw(F, out) {
    const t = F.time, drift = [t * 0.12, t * 0.05], tgt = [drift[0], 0, drift[1] + 1.2];
    const D = this.dr, r = Math.random, drop = (x, z, size) => { D.set([tgt[0] + x, tgt[2] + z, size, 0], (this.di++ % 14) * 4); };
    for (let i = 0; i < 14; i++) D[i * 4 + 3] += F.dt;
    if(this.beat!==A.beat){
      this.beat=A.beat;
      drop((r()-.5)*2.8,(r()-.5)*1.9,.40+.48*Math.min(1,A.kickAmp/3));
    }
    const eye = [drift[0] + Math.sin(t * 0.06) * 0.5, 1.88, drift[1] - 2.9];
    const c = camera(eye, tgt, 0.76, Math.sin(t * 0.05) * 0.012, 0.1, 60); F.focus = Math.hypot(...sub(eye, tgt)) + 0.5;
    draw(this.p, out, T.sw, T.sh, u => { F.set(u); setCam(u, c); gl.uniform4fv(u.uDr, D); });
  } });
}

// 90_engine.js

// ═════════════════════════ 5 · Frame loop ═════════════════════════
resize();
let sceneIx = 0, prevIx = -1, prevLive = false, needStill = false, slot = 0, xfAt = -10, switchedAt = -10;
let time = 0, frames = 0, travel = 0, last = performance.now(), cycle = false, cycleAt = 0, warm = false;
let palMode = -1;                                        // -1: each scene's own palette
const palX = { from: -1, to: -1, at: -10 };
const XF_SECONDS = 1.1, PAL_SECONDS = 1.2;
let stillPost = POST_DEFAULT, lastPost = POST_DEFAULT;
const smooth01 = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const mixPost = (a, b, m) => { const o = {}; for (const k in POST_DEFAULT) o[k] = a[k] + (b[k] - a[k]) * m; return o; };

function ensure(S) {
  if (S._ok || S._bad) return S._ok;
  try { S.init && S.init(); S._ok = true; } catch (e) { S._bad = true; console.error('scene ' + S.id + ': ' + (e && e.message || e)); }
  resetState(); return S._ok;
}
function setScene(i) {
  const n = ((i % SCENES.length) + SCENES.length) % SCENES.length; cycleAt = time;
  if (n === sceneIx) { renderModes(); return; }
  // Mid-fade, the picture on screen is already a blend: freeze that blend and fade out of the still instead.
  if (prevIx >= 0 && time - xfAt < XF_SECONDS) { needStill = true; prevLive = false; } else prevLive = true;
  prevIx = sceneIx; sceneIx = n; slot ^= 1; xfAt = time; switchedAt = time; perf.n = 0; perf.sum = 0; renderModes();
}
function setPalette(m) { palMode = m; renderModes(); }

// Adaptive resolution: if the display cannot hold its frame rate, render fewer pixels rather than drop frames.
const gov = { acc: 0, n: 0, best: 1, calm: 0, changes: 0 };
function govern(raw) {
  if (raw > 0.25 || document.hidden || !warm || time - xfAt < XF_SECONDS + 0.5) return;   // stalls, hidden tabs and cross-fades say nothing about the GPU
  gov.acc += raw; gov.n++; gov.best = Math.min(gov.best, raw);
  if (gov.n < 50) return;
  const avg = gov.acc / gov.n, refresh = Math.max(gov.best, 1 / 240); gov.acc = 0; gov.n = 0; gov.best = 1;
  if (avg > Math.max(0.0195, refresh * 1.35) && budgetScale > 0.3) { budgetScale *= 0.78; gov.calm = 0; gov.changes++; resize(); }
  else if (avg < 0.0175 && budgetScale < 1 && ++gov.calm > 14) { budgetScale = Math.min(1, budgetScale * 1.2); gov.calm = 0; gov.changes++; resize(); }
}
// Optional GPU timing (?perf): the whole frame inside one timer query, read back a few frames later.
const perf = { ext: stage.measure ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null, q: [], ms: 0, n: 0, sum: 0 };

function frame(now) {
  const raw = (now - last) / 1000; last = now; govern(raw);
  const dt = Math.min(0.05, raw);
  analyse(dt); render(dt);
  requestAnimationFrame(frame);
}

// Draw one scene into its own HDR buffer (and through depth of field if it asks for it).
function drawScene(S, sl, dt) {
  const out = RT('s' + sl);
  if (!ensure(S)) { gl.bindFramebuffer(gl.FRAMEBUFFER, out.f); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return out; }
  const hue = S.hue ? S.hue(time, travel, A) : time * 0.012;
  const pm = smooth01((time - palX.at) / PAL_SECONDS);
  const pa = PALETTES[palX.from < 0 ? S.pal || 0 : palX.from].v, pb = PALETTES[palX.to < 0 ? S.pal || 0 : palX.to].v;
  const F = { time, dt, travel, A, focus: 10, px: T.sh / 900,
    set(u) {
      gl.uniform1f(u.uTime, time); gl.uniform1f(u.uBass, A.bass); gl.uniform1f(u.uMid, A.mid); gl.uniform1f(u.uHigh, A.high); gl.uniform1f(u.uLevel, A.level);
      gl.uniform1f(u.uBassS, A.bassS); gl.uniform1f(u.uMidS, A.midS); gl.uniform1f(u.uHighS, A.highS); gl.uniform1f(u.uLevelS, A.levelS);
      gl.uniform1f(u.uKick, A.kick); gl.uniform1f(u.uKickL, A.kickL); gl.uniform1f(u.uSnare, A.snare); gl.uniform1f(u.uDyn, A.dyn); gl.uniform1f(u.uDrop, A.drop); gl.uniform1f(u.uAccent, A.accent); gl.uniform1f(u.uSlowHead, slowU); gl.uniform1fv(u.uPulse, A.pulse);
      gl.uniform1f(u.uHue, hue); gl.uniform1f(u.uTravel, travel); gl.uniform2f(u.uRes, T.sw, T.sh); gl.uniform1f(u.uHistHead, histU); gl.uniform1f(u.uPx, T.sh / 900);
      if (pm >= 1 || pa === pb) { gl.uniform3fv(u.uPA, pb); gl.uniform1f(u.uPalMix, 0); } else { gl.uniform3fv(u.uPA, pa); gl.uniform3fv(u.uPB, pb); gl.uniform1f(u.uPalMix, pm); }
      bindTex(0, specTex); gl.uniform1i(u.uSpec, 0); bindTex(1, waveTex); gl.uniform1i(u.uWave, 1); bindTex(2, histTex); gl.uniform1i(u.uHist, 2); bindTex(6, slowTex); gl.uniform1i(u.uSlow, 6);
    } };
  S.draw(F, out); resetState();
  if (!S.post.dof || !HDR) return out;
  const d = RT('d' + sl);
  draw(POST.dof, d, T.sw, T.sh, u => { bindTex(0, out.t); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uPx, 1 / T.sw, 1 / T.sh);
    gl.uniform1f(u.uFocus, F.focus); gl.uniform1f(u.uAperture, S.post.dof.ap * T.sh / 900); gl.uniform1f(u.uMaxCoc, S.post.dof.max * T.sh / 900); });
  return d;
}

let histU = 0;
function render(dt) {
  time += dt; frames++;
  if (cycle && time - cycleAt > 24) setScene(sceneIx + 1);
  if (palMode !== palX.to) { palX.from = palX.to; palX.to = palMode; palX.at = time; }
  // travel: distance flown, on the slow envelopes, so anything in flight speeds up and eases off instead of lurching
  travel += dt * (0.55 + A.bassS * 2.2 + A.kick * 1.2);
  let q = null;
  if (perf.ext) { q = gl.createQuery(); gl.beginQuery(perf.ext.TIME_ELAPSED_EXT, q); }
  if (A.analyser) {
    bindTex(0, specTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BANDS, 1, gl.RG, gl.UNSIGNED_BYTE, A.specU8);
    bindTex(1, waveTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WAVE, 1, gl.RED, gl.UNSIGNED_BYTE, A.waveU8);
  }
  // The waterfall advances at a fixed rate whatever the frame rate; the fractional part scrolls it between rows.
  histAcc += dt * HIST_HZ; bindTex(2, histTex);
  for (let n = Math.min(4, Math.floor(histAcc)); n > 0; n--) { histHead = (histHead + 1) % HIST_H; gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, histHead, HIST_W, 1, gl.RED, gl.FLOAT, A.histRow); }
  histAcc -= Math.floor(histAcc);
  histU = (histHead - 1 + histAcc + 0.5) / HIST_H;
  A.slowAcc += dt * 30; bindTex(6, slowTex);
  for (let n = Math.min(3, Math.floor(A.slowAcc)); n > 0; n--) { slowHead = (slowHead + 1) % 512; gl.texSubImage2D(gl.TEXTURE_2D, 0, slowHead, 0, 1, 1, gl.RGBA, gl.FLOAT, A.slowRow); }
  A.slowAcc -= Math.floor(A.slowAcc); slowU = (slowHead - 1 + A.slowAcc + 0.5) / 512;

  // 1. the scene, or two of them while they cross-fade
  const S = SCENES[sceneIx], m = smooth01((time - xfAt) / XF_SECONDS);
  if (needStill) { needStill = false; stillPost = lastPost; draw(POST.copy, RT('still'), T.sw, T.sh, u => { bindTex(0, RT('mix').t); gl.uniform1i(u.uA, 0); }); }
  if (m >= 1) prevIx = -1;
  let img = drawScene(S, slot, dt), post = S.post;
  if (prevIx >= 0) {
    const from = prevLive ? drawScene(SCENES[prevIx], slot ^ 1, dt) : RT('still');
    draw(POST.mix, RT('mix'), T.sw, T.sh, u => { bindTex(0, from.t); gl.uniform1i(u.uA, 0); bindTex(1, img.t); gl.uniform1i(u.uB, 1); gl.uniform1f(u.uMix, m); });
    img = RT('mix'); post = mixPost(prevLive ? SCENES[prevIx].post : stillPost, S.post, m);
  }
  lastPost = post;
  // 2. trails (feedback)
  const src = RT('trail' + (T.flip ? 1 : 0)), dst = RT('trail' + (T.flip ? 0 : 1)); T.flip = !T.flip;
  draw(POST.trail, dst, T.sw, T.sh, u => { bindTex(0, img.t); gl.uniform1i(u.uCur, 0); bindTex(1, src.t); gl.uniform1i(u.uPrev, 1);
    gl.uniform1f(u.uDecay, post.trail); gl.uniform1f(u.uZoom, post.zoom * (1 + A.bassS)); gl.uniform1f(u.uSpin, post.spin); });
  // 3. bloom
  const half = o => [0.5 / o.w, 0.5 / o.h];
  draw(POST.pre, T.down[0], T.down[0].w, T.down[0].h, u => { bindTex(0, dst.t); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uHalf, 0.5 / T.sw, 0.5 / T.sh); gl.uniform1f(u.uThr, post.thr); gl.uniform1f(u.uKnee, post.knee); });
  for (let i = 1; i < LEVELS; i++) draw(POST.down, T.down[i], T.down[i].w, T.down[i].h, u => { bindTex(0, T.down[i - 1].t); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uHalf, ...half(T.down[i - 1])); });
  for (let i = LEVELS - 2; i >= 0; i--) {
    const from = i === LEVELS - 2 ? T.down[LEVELS - 1] : T.up[i + 1];
    draw(POST.up, T.up[i], T.up[i].w, T.up[i].h, u => { bindTex(0, from.t); gl.uniform1i(u.uSrc, 0); bindTex(1, T.down[i].t); gl.uniform1i(u.uAdd, 1); gl.uniform2f(u.uHalf, ...half(from)); gl.uniform1f(u.uSpread, post.spread); });
  }
  // 4. composite to screen
  draw(POST.final, null, T.w, T.h, u => { bindTex(0, dst.t); gl.uniform1i(u.uScene, 0); bindTex(1, T.up[0].t); gl.uniform1i(u.uBloom, 1);
    gl.uniform1f(u.uKick, A.kick); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uFade, smooth01(time / 0.8));
    gl.uniform1f(u.uBloomAmt, post.bloom * (1 + A.kick * 0.6 * post.pulse)); gl.uniform1f(u.uPulseAmt, post.pulse); gl.uniform1f(u.uExposure, post.exp); gl.uniform2f(u.uRes, T.w, T.h);
    gl.uniform1f(u.uCA, post.ca); gl.uniform1f(u.uVig, post.vig); gl.uniform1f(u.uGrain, post.grain); });
  if (q) { gl.endQuery(perf.ext.TIME_ELAPSED_EXT); perf.q.push(q);
    while (perf.q.length && gl.getQueryParameter(perf.q[0], gl.QUERY_RESULT_AVAILABLE)) { const d = perf.q.shift();
      if (!gl.getParameter(perf.ext.GPU_DISJOINT_EXT)) { perf.ms = gl.getQueryParameter(d, gl.QUERY_RESULT) / 1e6; perf.sum += perf.ms; perf.n++; } gl.deleteQuery(d); } }
}
// Review aid: render n frames back to back and wait for the GPU, giving true milliseconds per frame.
function bench(n = 200) { const px1 = new Uint8Array(4); render(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
  const t0 = performance.now(); for (let i = 0; i < n; i++) render(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
  return (performance.now() - t0) / n; }

// This instance initializes one scene. Its canvas and all GPU allocations retire together.
sceneIx = SCENES.findIndex(s => s.id === stage.sceneId);
if (sceneIx < 0 || !ensure(SCENES[sceneIx])) throw new Error('Visualizer scene unavailable: ' + stage.sceneId);
warm = true;
time = 1;
let rate = 0;
const budget = frameBudget();
const originalPalettes = PALETTES.map(p => p.v.slice());
return {
  resize(width, height) {
    if (width === innerWidth && height === innerHeight) return;
    innerWidth = width; innerHeight = height;
    resize();
  },
  tint(rgb) {
    for (let i = 0; i < PALETTES.length; i++) {
      for (let channel = 0; channel < 3; channel++) {
        const original = originalPalettes[i][channel];
        PALETTES[i].v[channel] = rgb ? original * .88 + rgb[channel] * .12 : original;
      }
    }
  },
  resetBudget: budget.reset,
  frame(seconds, sample, targetSeconds) {
    const dt = Math.min(.05, Math.max(0, seconds));
    if (sample) {
      if (rate !== sample.sampleRate) {
        rate = sample.sampleRate;
        A.ctx = { sampleRate: rate };
        A.binOf = Array.from({length: BANDS + 1}, (_, i) =>
          Math.min(2047, Math.max(1, Math.round(28 * Math.pow(16000 / 28, i / BANDS) * 4096 / rate))));
      }
      A.freq = sample.frequency;
      A.time = sample.waveform;
      A.fastF = sample.shortFrequency;
      A.analyser = stage.analysisRange;
    } else A.analyser = null;
    gov.best = Math.min(gov.best, targetSeconds);
    govern(Math.min(.24, seconds));
    analyse(dt);
    render(dt);
    return budget.sample(seconds, targetSeconds, budgetScale <= .3);
  },
  stats() {
    return { scene: SCENES[sceneIx].id, frames, resolution: [T.sw, T.sh], beat: A.beat, level: A.level,
      gpuMs: perf.n ? perf.sum / perf.n : null };
  },
};

}
