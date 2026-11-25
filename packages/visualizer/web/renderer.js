// Generated from packages/visualizer/scenes by tools/build-web.ts.
import { frameBudget } from './frame-budget';
import { webPrograms } from './programs';
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
//   hit[0..2] (low, mid, high)          onsets found on a second, short FFT (1024 samples, no smoothing), so they are
//                                       known within a frame or two of the sound. Each has n (a counter), amp (0..1, how
//                                       hard against the recent hardest), fast (jumps on the onset, gone in ≈150 ms: for
//                                       light), slow (eased, for form) and lvl (the band's level now). The threshold
//                                       adapts to the material, so busy music does not fire it constantly.
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
  fast: null, fastF: null, hit: [0, 1, 2].map(() => ({ n: 0, amp: 0, imp: 0, fast: 0, slow: 0, slowA: 0, hold: 0, lvl: 0, prev: 0, mean: 0, dev: 0.3, peak: 0.8, top: 1, since: 9 })),
  hitLin: new Float32Array(3), hitFast: new Float32Array(3), hitSlow: new Float32Array(3), hitLvl: new Float32Array(3),
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
  analyseHits(dt);
  // One waterfall row: the medium bands, halved and lightly smoothed across frequency.
  for (let c = 0; c < HIST_W; c++) { const i = c * 2;
    A.histRow[c] = (A.bandsM[Math.max(0, i - 1)] + 2 * A.bandsM[i] + 2 * A.bandsM[i + 1] + A.bandsM[Math.min(BANDS - 1, i + 2)]) / 6; }
}

// Three-band onsets from the short FFT. Kept as one function so a native host can call exactly this after its
// own long-FFT analysis. Reads A.fast (the 1024 analyser); writes A.hit[], A.hitFast, A.hitSlow, A.hitLvl.
function analyseHits(dt) {

  const hz = A.ctx.sampleRate / 1024, top = A.fastF.length - 1, GAP = [0.24, 0.1, 0.06], SIGMA = [3, 2.4, 2.45], FLOOR = [0.3, 0.18, 0.22], EDGE = [[35, 150], [250, 2500], [5000, 14000]], lin = A.hitLin;
  for (let k = 0; k < 3; k++) { let s = 0, n = 0;                       // all three band levels first, so each is compared with this frame's others
    for (let b = Math.max(1, Math.round(EDGE[k][0] / hz)), e = Math.min(top, Math.round(EDGE[k][1] / hz)); b <= e; b++) { s += Math.pow(10, A.fastF[b] / 20); n++; }
    lin[k] = n ? s / n : 0; }
  const loud = Math.max(lin[0], lin[1], lin[2]);
  for (let k = 0; k < 3; k++) { const H = A.hit[k];
    const en = Math.log(1 + 400 * lin[k]), flux = Math.max(0, en - H.prev); H.prev = en; H.since += dt;
    H.top = Math.max(en, H.top * Math.exp(-dt / 12), 1); H.lvl = env(H.lvl, Math.min(1, en / H.top), dt, 60, 9);
    H.peak = Math.max(flux, H.peak * Math.exp(-dt / 6), 0.8);
    if (flux > H.mean + SIGMA[k] * H.dev + FLOOR[k] && H.since > GAP[k] && lin[k] > 0.1 * loud) {   // a band fires on its own sound, not on another's leakage
      H.n++; H.amp = Math.min(1, flux / H.peak); H.imp = Math.max(H.imp, 0.35 + 0.65 * H.amp); H.hold = 1; H.since = 0; }
    H.dev += (Math.abs(flux - H.mean) - H.dev) * Math.min(1, dt * 1.2); H.mean += (flux - H.mean) * Math.min(1, dt * 1.2);
    H.imp *= Math.exp(-dt * 9); H.fast = env(H.fast, H.imp, dt, 40, 40); H.hold *= Math.exp(-dt * 3.6);   // fast: half way up within a frame, never a step
    H.slowA = env(H.slowA, Math.max(0, H.hold - 0.15) / 0.85 * 1.25 * (0.4 + 0.6 * H.amp), dt, 34, 34); H.slow = env(H.slow, H.slowA, dt, 34, 34);
    A.hitFast[k] = H.fast; A.hitSlow[k] = H.slow; A.hitLvl[k] = H.lvl; }
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
const desktopLoops = !stage.constrained && (stage.sceneId === 'sea' || stage.sceneId === 'aurora');
const LIB = `${desktopLoops ? 'uniform ivec2 uNoisePulseCounts;' : ''}
uniform float uTime, uBass, uMid, uHigh, uLevel, uBassS, uMidS, uHighS, uLevelS, uKick, uKickL, uSnare;
uniform float uDyn, uDrop, uAccent, uSlowHead; uniform sampler2D uSlow;
uniform vec3 uHit, uHitS, uBandE;   // low, mid, high: uHit jumps on an onset (light), uHitS is eased (form), uBandE is the level now
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
  for (int i = 0; ${desktopLoops ? "i < uNoisePulseCounts.y; i++){ float a = uPulse" : "i < 8; i++){ float a = uPulse"}[i], d = (x-a*speed)/width;
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
float fbm(vec3 p){ float a = .5, s = 0.; for (int i = 0; ${desktopLoops && stage.sceneId === 'sea' ? "i < uNoisePulseCounts.x; i++){ s += a*noise" : "i < 4; i++){ s += a*noise"}(p); p = p*2.03+vec3(1.7,9.2,3.1); a *= .5; } return s; }
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

const program = webPrograms(gl);
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

// ───────────── Shared helpers for scenes: reduced-resolution targets and a 2D fluid solver ─────────────
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
  const { w, h, dw, dh, v, p, aux, d } = this, tx = [1 / w, 1 / h], asp = o.asp || w / h;   // o.asp: the aspect of the screen area the grid is stretched over
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
  for (let i = 0, n = stage.constrained && stage.sceneId === 'incense' ? 10 : (o.iters || 18); i < n; i++) {
    pass(FLUID.jacobi, p[1], w, h, u => { bindTex(4, p[0].t); gl.uniform1i(u.uPrs, 4); bindTex(5, aux.t); gl.uniform1i(u.uDiv, 5); gl.uniform2fv(u.uTx, tx); gl.uniform1f(u.uKeep, i ? 1 : 0.8); });
    [p[0], p[1]] = [p[1], p[0]];
  }
  pass(FLUID.grad, v[1 - cur], w, h, u => { bindTex(4, v[cur].t); gl.uniform1i(u.uVel, 4); bindTex(5, p[0].t); gl.uniform1i(u.uPrs, 5); gl.uniform2fv(u.uTx, tx); });
  if (cur === 0) [v[0], v[1]] = [v[1], v[0]];
  // dye: carried by the flow, then the scene adds and fades it
  pass(FLUID.advect, d[1], dw, dh, u => { bindTex(4, v[0].t); gl.uniform1i(u.uVel, 4); bindTex(5, d[0].t); gl.uniform1i(u.uSrc, 5); gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uKeep, 1); gl.uniform1f(u.uAsp, asp); gl.uniform1f(u.uWall, 0); });
  pass(o.dye, d[0], dw, dh, u => { o.set(u); bindTex(4, v[0].t); gl.uniform1i(u.uVel, 4); bindTex(5, d[1].t); gl.uniform1i(u.uDye, 5); gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uAsp, asp); });
};

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

// 34_sea.js

// ───────────────────────── Mercury Tide: open ocean to the horizon under a low sun ─────────────────────────
{
// The surface is a grid projected from the camera onto the water plane, so it always reaches the horizon and
// spends its vertices evenly on screen. Seven trochoidal swells move it; six finer wind waves shade it.
const SEA_FN = `
${desktopLoops ? "uniform ivec2 uSeaLayers;\nconst vec3 WV[7]" : "const vec3 WV[7]"} = vec3[7](vec3(.05,61.,0.), vec3(-.32,37.,1.7), vec3(.41,23.,4.1), vec3(-.12,14.3,2.3), vec3(.63,8.9,5.2), vec3(-.55,5.7,.9), vec3(.22,3.6,3.3));
// displacement of the point at rest p; nrm takes the surface normal; px is the size of a pixel on the water,
// so waves too fine to draw are left out of the shading instead of shimmering
vec3 swell(vec2 p, float S, float px, out vec3 nrm){
  vec3 d = vec3(0.), n = vec3(0.,1.,0.); float warp = noise(vec3(p*.013, uTime*.03))*5.;
  for (int i = 0; ${desktopLoops ? "i < uSeaLayers.x; i++" : "i < 7; i++"}){
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
  for (int i = 0; ${desktopLoops ? "i < uSeaLayers.y; i++" : "i < 3; i++"}){ float fi = float(i), sc2 = .55*pow(2.6, fi), e = .12/sc2, keep = 1.-smoothstep(.15,.45,px*sc2*2.);
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
    const set = u => { F.set(u); setCam(u, c); if (desktopLoops) gl.uniform2i(u.uSeaLayers, 7, 3); };
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
${desktopLoops ? "uniform float uYaw; uniform ivec3 uAuroraLayers;" : "uniform float uYaw;"}
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
      for (int s = 0; ${desktopLoops ? "s < uAuroraLayers.x; s++" : "s < 14; s++"}){
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
  for (int i = 0; ${desktopLoops ? "i < uAuroraLayers.y; i++" : "i < 4; i++"}){ h += a*(1.-abs(2.*noise(vec3(x, 3.7, float(i)))-1.)); x *= 2.1; a *= .5; }
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
    ${desktopLoops ? "const vec3 offsets=vec3(0.,.03,.07), weights=vec3(.6,.25,.15); col=vec3(0.);\n    for (int i=0; i<uAuroraLayers.z; i++) col+=sky(qm+vec2(0.,offsets[i]),.5)*weights[i];" : "col = (sky(qm, .5)*.6+sky(qm+vec2(0.,.03), .5)*.25+sky(qm+vec2(0.,.07), .5)*.15);"}      // reflections draw out into streaks
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
    draw(this.p, lo, lo.w, lo.h, u => { F.set(u); if (desktopLoops) gl.uniform3i(u.uAuroraLayers, 14, 4, 3); gl.uniform2f(u.uRes, lo.w, lo.h); gl.uniform1f(u.uYaw, yaw); });
    draw(this.up, out, T.sw, T.sh, u => { F.set(u); if (desktopLoops) gl.uniform3i(u.uAuroraLayers, 14, 4, 3); gl.uniform1f(u.uYaw, yaw); bindTex(3, lo.t); gl.uniform1i(u.uLo, 3); });
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
const WC_W = 960, WC_H = 600;
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
uniform float uAsp; const float DUR = .5;
float psi(vec2 p){ return noise(vec3(p*3.2, uTime*.05)); }
float land(float a){ return exp(-a*12.)*3.6; }           // paint leaves the brush over a moment, never all at once
void main(){
  vec2 p = uv*vec2(uAsp, 1.), tx = 1./vec2(${WC_W}., ${WC_H}.); const float e = .02;
  // wet paint wanders: a slow, divergence-free drift; each fresh wash pushes outward from where it lands
  vec2 v = vec2(psi(p+vec2(0.,e))-psi(p-vec2(0.,e)), psi(p-vec2(e,0.))-psi(p+vec2(e,0.)))/(2.*e)*.011*(.5+uMidS);
  for (int i = 0; i < 8; i++){ float a = uWashAge[i]; if (a > 1.2) continue; vec2 d = (uv-uDropP[i].xy)*vec2(uAsp, 1.); float R = uDropP[i].z;
    v += d/(length(d)+1e-4)*exp(-dot(d,d)/(R*R*1.6))*smoothstep(0.,.1,a)*(1.-smoothstep(.2,1.,a))*.09; }
  float wet0 = texture(uState, uv).a;
  vec2 src = uv-v/vec2(uAsp, 1.)*uDt*(.25+wet0);
  vec4 s = texture(uState, src);
  vec4 av = (texture(uState, src+vec2(tx.x*1.5,0.))+texture(uState, src-vec2(tx.x*1.5,0.))+texture(uState, src+vec2(0.,tx.y*1.5))+texture(uState, src-vec2(0.,tx.y*1.5)))*.25;
  float k = clamp(s.a*uDt*24., 0., .6); s.rgb = mix(s.rgb, av.rgb, k); s.a = mix(s.a, av.a, k*.6);      // wet-in-wet: paint spreads where the paper is wet
  // washes
  for (int i = 0; i < 8; i++){ float a = uWashAge[i]; if (a > .7) continue; vec2 d = (uv-uDropP[i].xy)*vec2(uAsp, 1.); float r = length(d);
    float R=uDropP[i].z*(1.+.62*uBandE.x), seed=uDropP[i].w;
    float theta=atan(d.y,d.x), petal=.5+.5*sin(theta*9.+seed+1.5*sin(theta*3.+seed));
    float jag=.66+.25*petal+.22*noise(vec3(d*22.,seed));
    float rr=r/max(.001,R*jag);
    float reach=.55+.60*(1.-exp(-a*23.)), crown=exp(-pow((rr-reach)/.13,2.));
    float wet=(1.-smoothstep(reach*.48,reach,rr));
    float hit=(1.-exp(-a*30.))*exp(-a*10.)*.75*(wet*1.4+crown*.95)*(1.+.7*uBassS);   // the wash soaks in over a tenth of a second; it does not appear in one frame
    vec3 centre=paintOf(seed), fringe=paintOf(seed+.85+petal*.42);
    vec3 pigment=mix(centre,fringe,smoothstep(.13,.99,rr))*(.82+.37*petal);
    // Replace some previous pigment where the drop pushes a wet layer aside.
    s.rgb=mix(s.rgb,pigment*(.55+.75*uDropP[i].z/.26),clamp(hit*uDt*23.,0.,.8));   // a pale wash; only the biggest are strong
    vec2 fleckGrid=d/(R+.0001)*13., cell=floor(fleckGrid);
    vec2 offset=fract(fleckGrid)-vec2(hash2(cell+seed),hash2(cell+seed+3.));
    float spatter=exp(-dot(offset,offset)*31.)*step(.72,hash2(cell+seed+9.))*smoothstep(.50,.9,rr)*(1.-smoothstep(1.,1.7,rr));
    s.rgb+=fringe*spatter*exp(-a*23.)*uDt*27.;
    s.a=max(s.a,wet*.72);
  }
  // strokes: a loaded brush drawn quickly across the sheet for each mid onset. The brush lays paint along the
  // whole stretch it moved this frame, so a slow frame still leaves one connected mark; its bristles show
  // more and more as it runs dry, and it is pressed hardest in the middle of the stroke.
  for (int i = 0; i < 6; i++){ float a = uStk[i].w; if (a > DUR+uDt) continue;
    float u1 = clamp(a/DUR, 0., 1.), u0 = clamp((a-uDt)/DUR, 0., 1.), e1 = 1.-(1.-u1)*(1.-u1), e0 = 1.-(1.-u0)*(1.-u0);
    float ang = uStk[i].z, L = uStk2[i].x, cv = uStk2[i].z, w = uStk2[i].y*(.55+.45*sin(PI*min(u1*1.15, 1.)));
    vec2 dir = vec2(cos(ang), sin(ang)), per = vec2(-dir.y, dir.x), o0 = uStk[i].xy*vec2(uAsp, 1.);
    vec2 h0 = o0+L*(e0*dir+cv*e0*e0*per), h1 = o0+L*(e1*dir+cv*e1*e1*per), sg = h1-h0; float sl = length(sg); if (sl < 1e-6) continue;
    vec2 tg = sg/sl, nm = vec2(-tg.y, tg.x), d = p-h0; float al = dot(d, tg), ac = dot(d, nm)/w, dd = abs(ac);
    if (dd > 1.1 || al < 0. || al > sl) continue;                             // only the stretch covered this frame, with square ends, so successive frames never overlap
    float load = 1.-.8*u1, bris = smoothstep(.62-.5*load, .78-.5*load, noise(vec3(ac*4.5+ang*9., ang*31., e1*L*5.))*.6+noise(vec3(ac*13., ang*7., e1*L*9.))*.4+.25*load);
    float foot = smoothstep(1., .8, dd);
    s.rgb += paintOf(uStk2[i].w)*foot*bris*(.5+.5*load)*1.1; s.a = max(s.a, foot*.18); }
  // dots (hats) and splatter (snares)
  for (int i = 0; i < 8; i++){ float a = uDot[i].w; if (a > .4) continue; float dd = length((uv-uDot[i].xy)*vec2(uAsp, 1.))/uDot[i].z;
    s.rgb += (paintOf(float(i)*1.3)*.6+.5)*smoothstep(1., .7, dd)*land(a)*uDt*9.; s.a = max(s.a, smoothstep(1.3, .8, dd)*.3*smoothstep(0.,.1,a)); }
  for (int j = 0; j < 4; j++){ float a = uSpl[j].w; if (a > .5) continue; vec2 q = (uv-uSpl[j].xy)*vec2(uAsp, 1.)/.03, c = floor(q); float sd = uSpl[j].z;
    float h = hash2(c+sd*17.), keep = step(.74, h)*smoothstep(8., 1., length(c)+3.*hash2(c+sd*5.));
    float dd = length(q-c-.12-.76*vec2(hash2(c+sd), hash2(c+sd+3.)));
    s.rgb += paintOf(sd*3.+h)*smoothstep(.12+.3*h, .04, dd)*keep*land(a)*uDt*7.; s.a = max(s.a, smoothstep(.5, .1, dd)*keep*.5*smoothstep(0.,.1,a)); }
  s.a = max(s.a-uDt*.13, 0.);                                              // the paper dries
  s.rgb = min(s.rgb*exp(-uDt*(.026+.02*(1.-uDyn))*(1.+2.2*s.a)), vec3(3.));   // wet washes thin out sooner than dry strokes, which stay                             // and old paint fades, so the sheet keeps renewing
  o = s;
}`;
const FS_WC = FSH + COVER + `
out vec4 o; uniform sampler2D uState;
float tooth(vec2 p){ return noise(vec3(p*150., 1.))*.45+noise(vec3(p*64., 5.))*.35+noise(vec3(p*vec2(22., 300.), 9.))*.2; }
void main(){
  vec2 uv = gl_FragCoord.xy/uRes, p = uv*vec2(uRes.x/uRes.y, 1.), e = 1.5/vec2(${WC_W}., ${WC_H}.);   // the sheet is the screen, whatever its shape
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
    this.washAge = new Float32Array(8).fill(9); this.washSlot=0; this.si = 0; this.ki = 0; this.di = 0;
    this.h0=A.hit[0].n; this.h1=A.hit[1].n; this.h2=A.hit[2].n; },
  draw(F, out) {
    const t = F.time, r = Math.random, D = this.drops, S = this.spl, K = this.stk, K2 = this.stk2, O = this.dot;
    // the hand wanders the sheet slowly; strokes and dots fall near it, so the picture has a centre that moves
    const hand = [0.5 + 0.34 * Math.sin(t * 0.13 + Math.sin(t * 0.07) * 2), 0.5 + 0.3 * Math.sin(t * 0.17 + 1.3 + Math.cos(t * 0.05) * 2)];
    for (let j = 0; j < 4; j++) S[j * 4 + 3] += F.dt;
    for (let j = 0; j < 6; j++) K[j * 4 + 3] += F.dt;
    for (let j = 0; j < 8; j++) O[j * 4 + 3] += F.dt;
    for(let j=0;j<8;j++) this.washAge[j]+=F.dt;
    const H=A.hit;
    if(this.h0!==H[0].n && t-(this.washAt||0)>.3){                        // at most three washes a second, so the paper has time to dry between them
      this.h0=H[0].n; this.washAt=t;
      // a wash for each low hit, sized by how hard it was and how full the low end is: from a small bloom to a quarter of the sheet
      const i=this.washSlot++ % 8, strength=H[0].amp*(.35+.65*A.dyn);
      D.set([.1+r()*.8,.1+r()*.8,.045+.12*strength+.035*A.hitLvl[0],(this.washSlot*.89)%3],i*4);
      this.washAge[i]=0;
    }
    if (this.h1!==H[1].n) { this.h1=H[1].n; const j = this.ki++ % 6, len = 0.06 + 0.42 * r() ** 2 + 0.16 * H[1].amp;
      K.set([hand[0] + (r() - 0.5) * 0.5, hand[1] + (r() - 0.5) * 0.52, r() * 6.283, 0], j * 4); K2.set([len, 0.008 + 0.016 * H[1].amp + 0.005 * r(), (r() - 0.5) * (r() < 0.35 ? 1.6 : 0.5), A.noteBand * 9 + this.ki * 0.23], j * 4); }
    if (this.h2!==H[2].n) {
      this.h2=H[2].n;
      const angle=r()*6.283, cx=.1+.8*r(), cy=.1+.8*r(), count=3+Math.round(4*H[2].amp+3*A.hitLvl[2]);
      for(let j=0;j<count;j++){
        const dist=(j-2)*.029;
        O.set([cx+dist*Math.cos(angle),cy+dist*Math.sin(angle)+.012*(r()-.5),.008+.014*H[2].amp+.005*r(),0],(this.di++ & 7)*4);
      }
    }
    if(H[2].fast>.72 && H[2].since<F.dt*1.5) S.set([hand[0]+(r()-.5)*.5,hand[1]+(r()-.5)*.5,r(),0],(this.si++&3)*4);
    draw(this.sim, this.b, WC_W, WC_H, u => { F.set(u); bindTex(3, this.a.t); gl.uniform1i(u.uState, 3); gl.uniform1f(u.uDt, Math.min(F.dt, 1 / 30));
      gl.uniform1f(u.uAsp, T.sw / T.sh); gl.uniform1fv(u.uWashAge,this.washAge); gl.uniform4fv(u.uDropP, D); gl.uniform4fv(u.uSpl, S); gl.uniform4fv(u.uStk, K); gl.uniform4fv(u.uStk2, K2); gl.uniform4fv(u.uDot, O); });
    [this.a, this.b] = [this.b, this.a];
    draw(this.show, out, T.sw, T.sh, u => { F.set(u); bindTex(3, this.a.t); gl.uniform1i(u.uState, 3); });
  } });
}

// 61_ink.js

// ───────────────────────── Ink in Water: ink entering a lit tank from every side, unfurling and lingering ─────────────────────────
{
const INK_W = 256, INK_H = 160, INK_DW = 1024, INK_DH = 640;
// Each kick lets ink in somewhere new: dropped from above, pushed in from a side wall, rising from the floor,
// or bled into the middle. uDropP is where and which ink; uDropV is the push it arrives with and how it spreads.
const INK_COMMON = `
in vec2 uv; out vec4 o; uniform sampler2D uVel, uDye; uniform float uDt, uAsp; uniform float uJetAge[8]; uniform vec4 uDropP[8], uDropV[8];
float land(float a){ return (1.-exp(-a*45.))*exp(-a*11.)*1.25; }     // the jet opens within two frames instead of in one, then tails off
vec3 inkOf(float k){ k = mod(k, 3.); return clamp(vec3(max(1.-abs(k), 1.-abs(k-3.)), 1.-abs(k-1.), 1.-abs(k-2.)), 0., 1.); }`;
const FS_INK_FORCE = HEAD + LIB + INK_COMMON + `
void main(){
  vec2 v = texture(uVel, uv).xy; vec3 ink = texture(uDye, uv).rgb;
  v.y += (ink.r*.16-ink.b*.14)*uDt; v.x += (.5-uv.x)*ink.g*.2*uDt;            // the low ink rises from the floor, the high ink sinks from the surface, the mid ink is drawn in from the walls
  for (int i = 0; i < 8; i++){ float a = uJetAge[i]; if (a > .3) continue; vec2 d = (uv-uDropP[i].xy)*vec2(uAsp, 1.); float g = exp(-dot(d,d)/.0045);
    v += (uDropV[i].xy+uDropV[i].z*d/(length(d)+.02))*g*land(a)*uDt*(15.+16.*uDropV[i].w); }
  vec2 p = uv*vec2(uAsp, 1.); float t = uTime*.07;
  v += vec2(cos(p.y*2.3+t)+.5*cos(p.y*5.1-t*1.7), sin(p.x*1.9-t*1.3)+.5*sin(p.x*4.3+t*2.1))*uDt*.01*(.3+1.2*uMidS);   // the mids stir the tank, gently
  o = vec4(v, 0., 1.);
}`;
const FS_INK_DYE = HEAD + LIB + INK_COMMON + `
void main(){
  vec3 dye = texture(uDye, uv).rgb*exp(-uDt*.045);                           // it thins out only over a minute, so colours build up in layers
  // each band also seeps in steadily from its own side for as long as it sounds: lows from the floor, mids from the walls, highs from the surface
  float nx = noise(vec3(uv.x*9., uTime*.15, 1.)), ny = noise(vec3(uv.y*9., uTime*.15, 5.));
  dye.r += uBandE.x*uBandE.x*exp(-uv.y*uv.y/.006)*smoothstep(.3,.8,nx)*uDt*.5;
  dye.g += uBandE.y*uBandE.y*(exp(-uv.x*uv.x/.004)+exp(-(1.-uv.x)*(1.-uv.x)/.004))*smoothstep(.3,.8,ny)*uDt*.45;
  dye.b += uBandE.z*uBandE.z*exp(-(1.-uv.y)*(1.-uv.y)/.006)*smoothstep(.34,.84,nx)*uDt*1.3;
  for (int i = 0; i < 8; i++){ float a = uJetAge[i]; if (a > .3) continue; vec2 d = (uv-uDropP[i].xy)*vec2(uAsp, 1.);
    vec2 dir=normalize(uDropV[i].xy), per=vec2(-dir.y,dir.x);
    float along=dot(d,dir), across=dot(d,per);
    float tendril=sin(along*75.+uDropP[i].z)*.010;
    float w=.013+.02*uDropV[i].w;
    float plume=exp(-pow(along/.095,2.)-pow((across-tendril)/w,2.));
    plume+=.72*exp(-pow((along-.035)/.075,2.)-pow((across+tendril*2.)/(w*.72),2.));
    dye+=inkOf(uDropP[i].w)*plume*land(a)*uDt*(15.+17.*uDropV[i].w); }
  o = vec4(min(dye, vec3(1.25)), 1.);
}`;
const FS_INK = FSH + COVER + `
out vec4 o; uniform sampler2D uDye; uniform float uJetAge[8]; uniform vec4 uDropP[8], uDropV[8]; const vec2 TX = 1./vec2(${INK_DW}., ${INK_DH}.);
void main(){
  vec2 sc = gl_FragCoord.xy/uRes, uv = sc, q = sc-.5;                        // the tank is the screen, whatever its shape
  vec3 dye = texture(uDye, uv).rgb;
  vec3 gx = texture(uDye, uv+vec2(TX.x*2.,0.)).rgb-texture(uDye, uv-vec2(TX.x*2.,0.)).rgb, gy = texture(uDye, uv+vec2(0.,TX.y*2.)).rgb-texture(uDye, uv-vec2(0.,TX.y*2.)).rgb;
  vec2 g = vec2(dot(gx, vec3(1.)), dot(gy, vec3(1.)));
  // a tank lit from behind: soft, slightly cool light, brighter in the middle
  vec3 bg = mix(vec3(.74,.79,.84), vec3(.93,.94,.95), exp(-dot(q,q)*2.6))*(.82+.1*uLevelS);
  bg *= 1.+.05*sin(uv.y*40.+uTime+noise(vec3(uv*6., uTime*.2))*6.)*smoothstep(.75, 1., uv.y);       // light playing just under the surface
  vec3 c0 = mix(vec3(.04,.12,.5), neon(.0), .08), c1 = mix(vec3(.78,.05,.3), neon(.33), .08), c2 = mix(vec3(.98,.5,.04), neon(.66), .08);   // lows indigo, mids crimson, highs amber
  vec3 T = exp(-(dye.r*-log(max(c0, .03))+dye.g*-log(max(c1, .03))+dye.b*-log(max(c2, .03)))*1.1);
  // Narrow bands pick out existing filaments, leaving the pale water undisturbed.
  float pitch=clamp(.10+.78*uv.y+.06*sin(uv.x*16.),0.,1.);
  float edge=clamp(length(g)*2.+dot(dye,vec3(.08)),0.,1.);
  float lift=clamp(spec(pitch)-specS(pitch),0.,.55);
  vec3 col=bg*T+edge*lift*mix(vec3(.22,.36,.64),vec3(.53,.13,.24),uv.y)*.35;
  // The fluid needs a few frames to carry new pigment away from a nozzle. Show the first curl at the
  // nozzle immediately, then hand it off to the advected dye. Each band has a separate side and colour,
  // so isolated low/mid/high attacks make three genuinely different change images.
  for(int i=0;i<8;i++){
    float a=uJetAge[i]; if(a>.48) continue;
    vec2 d=(uv-uDropP[i].xy)*vec2(1.6,1.), dir=normalize(uDropV[i].xy), per=vec2(-dir.y,dir.x);
    float along=dot(d,dir), across=dot(d,per), grow=smoothstep(-.018,.105,along)*(1.-smoothstep(.105,.34,along));
    float curl=sin(along*48.+uDropP[i].z)*(.012+.018*smoothstep(0.,.18,a));
    float ribbon=exp(-pow((across-curl)/(.018+.038*a),2.))*grow;
    float mouth=exp(-dot(d,d)/(.0018+.012*a*a));
    float familyBoost=uDropP[i].w>1.5?1.38:1.;
    float fresh=(ribbon*.72+mouth)*exp(-a*6.2)*(1.15+.85*uDropV[i].w)*familyBoost;
    vec3 ic=uDropP[i].w<.5?vec3(.035,.12,.76):(uDropP[i].w<1.5?vec3(.92,.035,.28):vec3(1.,.48,.025));
    col=mix(col,ic*.42,clamp(fresh*.72,0.,.84)); col+=ic*fresh*.16;
  }
  // each ink lights up, wherever it has spread, when its own band is struck
  vec3 have=dye/(1.+dye);
  vec3 hg=uHit*.45+uHitS*.55;                                                 // mostly the eased envelope: a glow, not a flash
  col+=(vec3(.1,.3,.95)*have.r*hg.x+vec3(.95,.15,.4)*have.g*hg.y+vec3(1.,.7,.15)*have.b*hg.z)*.2;
  col *= 1.+clamp(dot(g, vec2(.5, .8))*.35, -.25, .3);                       // the plumes have body: lit on one side, shaded on the other
  col *= 1.-smoothstep(.985, 1., uv.y)*.25;                                  // the waterline
  o = vec4(col*(1.-.55*dot(q,q)), 1.);
}`;
scene({ id: 'ink', name: 'Ink in Water', from: 'Organic', kind: 'fluid', group: 'organic', pal: 0, hue: () => 0,
  about: 'A lit tank where each part of the music has its own ink and its own side: low hits push indigo up from the floor, mids bring crimson in from the walls, highs drop amber from the surface, and each band seeps in for as long as it sounds, so the tank fills and the colours layer',
  inputs: ['hit (low, mid, high: n, amp)', 'bandE', 'spec', 'specS', 'midS', 'levelS'],
  cost: 'Moderate: a 256×160 fluid solve (18 pressure iterations) and a 1024×640 dye field. Phones: 128×80 with 10 iterations and a 512×320 dye field.',
  post: { bloom: 0.06, thr: 1.6, exp: 1.0, ca: 0.15, vig: 0.3, grain: 0.02, pulse: 0 },
  init() { this.force = program(VS, FS_INK_FORCE); this.dye = program(VS, FS_INK_DYE); this.show = program(VS, FS_INK);
    this.fluid = new Fluid(INK_W, INK_H, INK_DW, INK_DH); this.P = new Float32Array(32); this.V = new Float32Array(32); this.last = new Float32Array(8).fill(9); this.n = 0; this.age = new Float32Array(8).fill(9); this.sn = A.snares; this.nn = A.notes; this.noteAt = -1; this.beat=A.beat; this.h0 = A.hit[0].n; this.h1 = A.hit[1].n; this.h2 = A.hit[2].n; this.side = false; },
  draw(F, out) {
    // Each band has its own ink and its own side of the tank, so you can read the music by colour and place:
    // low hits push indigo up from the floor, mid hits bring crimson in from a wall, high hits drop amber from the surface.
    for (let j = 0; j < 8; j++) this.age[j] += F.dt;
    const r = Math.random, jet = (x, y, dx, dy, dye, strength) => { const i = this.n++ % 8; this.age[i] = 0; this.P.set([x, y, this.n * 2.4, dye], i * 4); this.V.set([dx, dy, 0.12, strength], i * 4); };
    const H = A.hit;
    if (H[0].n !== this.h0) { this.h0 = H[0].n; jet(0.12 + r() * 0.76, 0.07, (r() - 0.5) * 0.5, 1.1, 0, 0.35 + 0.65 * H[0].amp); }
    if (H[1].n !== this.h1) { this.h1 = H[1].n; const left = (this.side = !this.side); jet(left ? 0.09 : 0.91, 0.2 + r() * 0.6, left ? 1 : -1, (r() - 0.5) * 0.5, 1, 0.5 + 0.5 * H[1].amp); }
    if (H[2].n !== this.h2) { this.h2 = H[2].n; jet(0.1 + r() * 0.8, 0.94, (r() - 0.5) * 0.3, -0.9, 2, 0.7 + 0.3 * H[2].amp); }
    this.fluid.step(F.dt, { force: this.force, dye: this.dye, set: u => { F.set(u); gl.uniform1fv(u.uJetAge, this.age); gl.uniform4fv(u.uDropP, this.P); gl.uniform4fv(u.uDropV, this.V); }, asp: T.sw / T.sh, keepV: 0.984, vort: 6, iters: 18, wall: 0.03 });
    draw(this.show, out, T.sw, T.sh, u => { F.set(u); bindTex(3, this.fluid.d[0].t); gl.uniform1i(u.uDye, 3); gl.uniform1fv(u.uJetAge, this.age); gl.uniform4fv(u.uDropP, this.P); gl.uniform4fv(u.uDropV, this.V); });
  } });
}

// 62_incense.js

// ───────────────────────── Incense: three sticks, three smokes, one for each part of the music ─────────────────────────
{
// Three incense sticks stand in a dark room. The left one is the bass, the middle one the mids, the right
// one the highs: each gives off smoke of its own colour as fast as its band is sounding, and puffs on its
// band's onsets. The smoke rises, spreads into a wide fan and lingers; kicks breathe across the room.
const SMK_W = stage.constrained ? 128 : 256, SMK_H = stage.constrained ? 80 : 160, SMK_DW = stage.constrained ? 512 : 1024, SMK_DH = stage.constrained ? 320 : 640;
const SMK_COMMON = `
in vec2 uv; out vec4 o; uniform sampler2D uVel, uDye; uniform float uDt, uAsp; uniform vec3 uTip[3]; uniform float uSide[8];
vec3 own(int i){ return vec3(float(i == 0), float(i == 1), float(i == 2)); }`;
const FS_SMK_FORCE = HEAD + LIB + SMK_COMMON + `
void main(){
  vec2 v = texture(uVel, uv).xy; vec3 sm = texture(uDye, uv).rgb; float den = dot(sm, vec3(1.));
  v.y += (sm.r*(.4+.9*uBandE.x)+sm.g*(.45+.8*uBandE.y)+sm.b*(.5+.8*uBandE.z))*uDt;      // each smoke rises faster while its own band sounds
  for (int i = 0; i < 3; i++){ vec2 d = (uv-uTip[i].xy)*vec2(uAsp, 1.);
    v += vec2(0., 1.)*exp(-dot(d,d)/.0004)*uDt*(3.5+3.*uBandE[i]+4.*uHitS[i]); }                 // the draught of each ember; an onset puffs it
  for (int i = 0; i < 8; i++){ float a = uPulse[i]; if (a > .9) continue;                        // each kick: a breath of air across the room, alternating sides
    float front = uv.y-.27-a*.95, gust = exp(-front*front/.043)*exp(-a*4.);
    v.x += uSide[i]*gust*uDt*1.6; }
  // higher up the columns lean apart, so the smoke opens into a wide fan and fills the room
  float height = smoothstep(.2,.8,uv.y);
  v.x += (tanh((uv.x-.5)*5.)*.2+sin(uv.y*11.-uTime*.2)*.1)*height*uDt*min(den, 1.);
  v.x += uDt*(sin(uv.y*15.+uTime*.2)*uHitS.z*.5+sin(uv.y*24.-uTime*.2)*uBandE.z*.15)*smoothstep(.2,.68,uv.y);   // highs set it trembling
  o = vec4(v, 0., 1.);
}`;
const FS_SMK_DYE = HEAD + LIB + SMK_COMMON + `
void main(){
  vec3 s = texture(uDye, uv).rgb*exp(-uDt*.07);                              // it lingers: about fifteen seconds
  for (int i = 0; i < 3; i++){ vec2 d = (uv-uTip[i].xy)*vec2(uAsp, 1.);
    s += own(i)*exp(-dot(d,d)/.00011)*uDt*(3.+16.*uBandE[i]*uBandE[i]+22.*uHit[i]); }             // quiet band: a thread; loud band: a column; an onset: a puff
  s *= 1.-uDt*2.*smoothstep(.93, 1., uv.y);
  o = vec4(min(s, vec3(3.)), 1.);
}`;
const FS_SMK = FSH + COVER + `
out vec4 o; uniform sampler2D uDye; uniform vec3 uTip[3]; const vec2 TX = 1./vec2(${SMK_DW}., ${SMK_DH}.);
void main(){
  vec2 sc = gl_FragCoord.xy/uRes, uv = cover(sc, 1.6), q = sc-.5, p = uv*vec2(1.6, 1.);
  vec3 s = texture(uDye, uv).rgb; float den = dot(s, vec3(1.));
  vec3 gx = texture(uDye, uv+vec2(TX.x*2.5,0.)).rgb-texture(uDye, uv-vec2(TX.x*2.5,0.)).rgb, gy = texture(uDye, uv+vec2(0.,TX.y*2.5)).rgb-texture(uDye, uv-vec2(0.,TX.y*2.5)).rgb;
  vec2 g = vec2(dot(gx, vec3(1.)), dot(gy, vec3(1.)));
  // a dark room: a little warm light low down, and one cool lamp off to the right
  vec3 col = vec3(.006,.005,.006)+vec3(.05,.03,.018)*exp(-pow((uv.y-.05)/.3, 2.))*(.4+.3*uBassS)*exp(-pow(q.x/.6, 2.));
  col += mix(vec3(.02,.03,.05), neon(.62)*.04, .4)*exp(-length((sc-vec2(.95,.75))*vec2(1.6,1.))*2.4);
  // three smokes, each its own colour, drifting slowly through the palette; where they meet they mix
  float hue = uTime*.012;
  vec3 c0 = mix(vec3(1.,.62,.36), neon(.08+hue), .45), c1 = mix(vec3(.55,.75,1.), neon(.42+hue), .45), c2 = mix(vec3(.72,1.,.78), neon(.75+hue), .45);
  vec3 tintc = (c0*s.r+c1*s.g+c2*s.b)/max(den, 1e-3);
  float a = 1.-exp(-den*2.), lit = clamp(.5-dot(g, normalize(vec2(1., .35)))*1.1, 0., 1.);        // lit from the right: every fold has a bright and a dark side
  vec3 glow = (c0*s.r*uHit.x+c1*s.g*uHit.y+c2*s.b*uHit.z)/max(den, 1e-3);                         // each smoke brightens on its own band's onsets
  vec3 smc = tintc*(.22+.75*lit)*(.55+.5*uLevelS)+glow*(.35+.4*lit);
  col = mix(col, smc, a*.9);
  // the sticks and their embers
  for (int i = 0; i < 3; i++){ vec2 tp = uTip[i].xy*vec2(1.6, 1.), base = tp+vec2(.1*(float(i)-1.)+.06, -.5), ab = base-tp, pa = p-tp; float h = clamp(dot(pa,ab)/dot(ab,ab), 0., 1.), ds = length(pa-ab*h);
    col = mix(col, vec3(.1,.065,.045)*(.5+2.5*exp(-h*10.)), smoothstep(.0035, .002, ds));
    float de = length(p-tp); vec3 ec = i == 0 ? c0 : (i == 1 ? c1 : c2);
    col += mix(vec3(1.,.42,.12), ec, .35)*(smoothstep(.007,.003,de)*(3.+7.*uBandE[i]+9.*uHit[i])+exp(-de*42.)*(.2+.5*uBandE[i]+.8*uHit[i])); }
  o = vec4(col*(1.-.6*dot(q,q)), 1.);
}`;
scene({ id: 'incense', name: 'Incense', from: 'Organic', kind: 'fluid', group: 'organic', pal: 0, hue: () => 0,
  about: 'Three incense sticks in a dark room, one each for bass, mids and highs: each gives off its own colour of smoke as fast as its band sounds and puffs on its onsets; the smokes rise, fan out, mix and slowly change colour',
  inputs: ['bandE', 'hit', 'hitS', 'bassS', 'levelS', 'pulse'],
  cost: 'Moderate: a 256×160 fluid solve (18 pressure iterations) and a 1024×640 smoke field. Phones: 128×80 with 10 iterations.',
  post: { bloom: 0.5, thr: 0.9, knee: 0.6, exp: 1.1, ca: 0.25, vig: 0.6, grain: 0.03, pulse: 0.2 },
  init() { this.force = program(VS, FS_SMK_FORCE); this.dye = program(VS, FS_SMK_DYE); this.show = program(VS, FS_SMK);
    this.fluid = new Fluid(SMK_W, SMK_H, SMK_DW, SMK_DH); this.side = new Float32Array(8); this.last = new Float32Array(8).fill(9); this.flip = 1;
    this.tips = new Float32Array([0.27, 0.15, 0, 0.5, 0.11, 0, 0.73, 0.16, 0]); },
  draw(F, out) {
    newPulses(this.last, i => { this.flip = -this.flip; this.side[i] = this.flip * (0.45 + 0.6 * Math.min(1, A.kickAmp / 3)); });
    const set = u => { F.set(u); gl.uniform3fv(u.uTip, this.tips); gl.uniform1fv(u.uSide, this.side); };
    this.fluid.step(F.dt, { force: this.force, dye: this.dye, set, keepV: 0.985, vort: 2.5 + 4 * A.hitLvl[2], iters: 18, wall: 0 });
    draw(this.show, out, T.sw, T.sh, u => { set(u); bindTex(3, this.fluid.d[0].t); gl.uniform1i(u.uDye, 3); });
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

// 64_forest.js

// ───────────────────────── Deep Forest: tall trees in backlight, wind running through the canopy with the music ─────────────────────────
{
// Real geometry, drawn with 4× MSAA and depth of field: 72 trunks (tapered, flared at the root, leaning),
// three limbs on each, 10,000 foliage cards gathered into crowns and understory, shafts of sun standing
// between the trunks, and pollen. The wind is the low end: each low onset sends a gust back through the wood.
// Every crown listens to a band of its own and glows with it; the shafts are bands too; highs set the leaves
// trembling and the pollen sparkling.
const FOR_TREES = 72, FOR_CARDS = 130, FOR_FERNS = 1400, FOR_SHAFTS = 24, FOR_POLLEN = 2600;
const FOREST_FN = `
const vec3 FSUN = vec3(.3145, .6093, .7279);               // toward the sun: ahead, above, a little to the right
vec3 fsunC(){ return mix(vec3(1.,.86,.55), neon(.1), .08)*(.7+.35*uDyn+.3*uBassS+.1*uHitS.x); }
vec3 fogC(vec3 v){ float s = pow(max(dot(v, FSUN), 0.), 3.); return mix(vec3(.016,.03,.024), vec3(.3,.38,.22), .08+.92*s)*(.55+.35*uDyn)+fsunC()*s*s*.4; }
// tree i: where it stands, how thick, how tall, how it leans
void tree(float i, out vec3 base, out float rad, out float ht, out vec2 lean){
  uint id = uint(i)*7u+11u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), h4 = hashu(id+3u), h5 = hashu(id+4u);
  float z = 3.+pow(h1, 1.25)*66., side = h2 < .5 ? -1. : 1.;
  base = vec3(side*(1.8+pow(h3, 1.4)*(7.+z*.22))+sin(z*.13)*1.2, 0., z);        // either side of a path that winds a little
  rad = .2+.42*h4*h4+.12*step(.9, h5); ht = 15.+11.*h5+rad*8.;
  lean = (vec2(hashu(id+5u), hashu(id+6u))-.5)*1.8; }
vec3 trunkAt(vec3 base, vec2 lean, float y, float ht){ float t = y/ht; return base+vec3(lean.x*t*t, y, lean.y*t*t); }
// the wind at p: a steady breath with the low end, and each beat's gust running back through the wood (four seconds, front to back)
float gustAt(vec3 p){ return .2+.95*hist(.03+.05*noise(vec3(p.x*.1, 0., 2.)), clamp((p.z-2.)/75., 0., 1.))+.3*uBassS; }`;
const VS_TRUNK = VSP + FOREST_FN + `
out vec3 vW, vN; out vec2 vBark; out float vDepth;
void main(){
  vec3 base; float rad, ht; vec2 lean; tree(float(gl_InstanceID), base, rad, ht, lean);
  int q = gl_VertexID/6, k = gl_VertexID%6; ivec2 c = ivec2(q%10+((k == 1 || k == 2 || k == 4) ? 1 : 0), q/10+((k == 2 || k == 4 || k == 5) ? 1 : 0));
  float t = float(c.y)/9., y = (t*t*.9+t*.1)*ht, a = float(c.x)/10.*TAU;                          // rings crowd toward the root
  float r = rad*(1.-.55*t)*(1.+.9*exp(-y*1.6)*(1.+.35*sin(a*3.+base.x*5.)))*(1.+.06*sin(a*2.+y*.7));   // taper, root flare, a little out of round
  vec3 ctr = trunkAt(base, lean, y, ht); ctr.xz += vec2(.75, .3)*gustAt(base)*t*t*.22;
  vN = vec3(cos(a), 0., sin(a)); vW = ctr+vN*r; vBark = vec2(a*rad*5.+base.x, y);
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const VS_LIMB = VSP + FOREST_FN + `
out vec3 vW, vN; out vec2 vBark; out float vDepth;
void main(){
  float ti = float(gl_InstanceID/3); uint id = uint(gl_InstanceID)*4u+101u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u);
  vec3 base; float rad, ht; vec2 lean; tree(ti, base, rad, ht, lean);
  int q = gl_VertexID/6, k = gl_VertexID%6; ivec2 c = ivec2(q%6+((k == 1 || k == 2 || k == 4) ? 1 : 0), q/6+((k == 2 || k == 4 || k == 5) ? 1 : 0));
  float t = float(c.y)/4., a = float(c.x)/6.*TAU, y0 = ht*(.42+.3*h1), az = h2*TAU, len = 3.+4.*h3+rad*5.;
  vec3 ax = normalize(vec3(cos(az), .55+.3*h3, sin(az))), s0 = trunkAt(base, lean, y0, ht);
  vec3 ctr = s0+ax*len*t+vec3(0., -.6*t*t, 0.); ctr.xz += vec2(.75, .3)*gustAt(base)*(y0/ht)*(y0/ht)*.22+vec2(.75,.3)*gustAt(ctr)*t*.12;
  vec3 u = normalize(cross(ax, vec3(0., 1., .01))), w = cross(ax, u); vN = u*cos(a)+w*sin(a);
  vW = ctr+vN*rad*.34*(1.-.75*t); vBark = vec2(a*rad*2.+h1*9., t*len);
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_BARK = FSH + FOREST_FN + `
in vec3 vW, vN; in vec2 vBark; in float vDepth; out vec4 o;
void main(){
  float b = noise(vec3(vBark.x*1.3, vBark.y*.3, 1.))*.6+noise(vec3(vBark.x*4.1, vBark.y*1.1, 5.))*.4, ridge = smoothstep(.36,.62,b);   // long furrows
  vec3 n = normalize(vN), v = normalize(uEye-vW), sc = fsunC();
  float fine = noise(vec3(vBark*vec2(11., 2.6), 2.)), crack = smoothstep(.5, .3, b)*smoothstep(.35, .6, noise(vec3(vBark.x*2.6, vBark.y*.5, 8.)));
  vec3 bark = mix(vec3(.012,.01,.008), vec3(.3,.21,.13), ridge)*(.45+.9*fine)*(1.-.7*crack);
  float moss = smoothstep(.5,.75, noise(vec3(vW.x*.8, vW.y*.45, vW.z*.8)))*smoothstep(5., .3, vW.y);
  bark = mix(bark, vec3(.06,.13,.03)*(.5+.9*ridge), moss*.85);
  float lit = max(dot(n, FSUN), 0.), rim = pow(1.-max(dot(n, v), 0.), 3.)*smoothstep(-.6, .5, dot(n, FSUN));      // the sun is behind them: it catches their edges
  vec3 col = bark*(vec3(.05,.085,.06)+sc*lit*1.5)*(.55+.6*ridge)+sc*(bark*6.+.04)*rim*(.5+.5*ridge);
  col *= .5+.5*smoothstep(0., 2.5, vW.y);
  float dist = length(vW-uEye); col = mix(col, fogC(-v), 1.-exp(-dist*.022));
  o = vec4(col, vDepth);
}`;
// Foliage: each card is a spray of small pointed leaves. uMode 0: gathered into the crowns; 1: ferns and seedlings on the floor.
const VS_FOLIAGE = VSP + FOREST_FN + `
uniform float uMode; out vec2 vUV; out vec3 vW; out vec4 vI; out float vDepth;
void main(){
  uint id = uint(gl_InstanceID)*6u+3u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), h4 = hashu(id+3u), h5 = hashu(id+4u), h6 = hashu(id+5u);
  vec3 ctr; float sz, lit, inner, band, wsc;
  if (uMode < .5){
    float ti = float(gl_InstanceID/${FOR_CARDS}); vec3 base; float rad, ht; vec2 lean; tree(ti, base, rad, ht, lean);
    float cr = 3.+rad*6., low = step(.7, h5), yc = mix(ht*(.55+.4*h4), ht*(.22+.3*h4), low), cz = h2*2.-1., sr = sqrt(1.-cz*cz);
    vec3 dirc = vec3(cos(h1*TAU)*sr, cz*.75+.12, sin(h1*TAU)*sr); inner = mix(pow(h3, .45), .5+.4*h3, low);   // most of them out in the shell of the crown
    ctr = trunkAt(base, lean, yc, ht)+dirc*cr*inner*vec3(1., .6, 1.);
    sz = 1.3+1.3*h6; lit = smoothstep(-.5, .8, dot(normalize(dirc), FSUN)); band = fract(ti*.618+.07); wsc = .5+yc/ht;
  } else {
    float z = 2.+pow(h1, 1.4)*40., side = h2 < .5 ? -1. : 1.;
    ctr = vec3(side*(1.+h3*h3*(6.+z*.2))+sin(z*.13)*1.2, .25+.5*h4, z); inner = .6+.4*h4;
    sz = .55+.75*h6; lit = .05+.5*h5*h5; band = h5; wsc = .35;
  }
  float g = gustAt(ctr), sway = g*(.1+.1*h4)*wsc;
  ctr.xz += vec2(.75, .3)*sway+vec2(sin(uTime*1.7+h1*40.), cos(uTime*1.3+h2*40.))*.02*(1.+4.*uBandE.z+3.*uHitS.z); ctr.y -= sway*.22;
  float a1 = h1*TAU+sin(uTime*(1.6+2.*h4)+h2*30.)*.16*(.4+g+2.*uHitS.z), a2 = h6*TAU;                      // the cards tremble; the highs set them off
  vec3 u = normalize(vec3(cos(a1), .35*sin(a2*3.), sin(a1))), up = normalize(vec3(sin(a2)*.7, 1., cos(a2)*.7)), w = normalize(cross(u, up));
  vec2 q = vec2(float(gl_VertexID == 1 || gl_VertexID == 2 || gl_VertexID == 4), float(gl_VertexID == 2 || gl_VertexID == 4 || gl_VertexID == 5));
  sz *= smoothstep(2.2, 5.5, length(ctr-uEye));                                 // nothing hangs right in front of the lens
  vW = ctr+(u*(q.x-.5)+w*(q.y-.5))*sz; vUV = q; vI = vec4(h3*31.+h5*7., lit, inner, band);
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_FOLIAGE = FSH + FOREST_FN + `
in vec2 vUV; in vec3 vW; in vec4 vI; in float vDepth; out vec4 o;
void main(){
  vec2 g = vUV*5., c = floor(g); float m = 0., tone = 0.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 cc = c+vec2(float(i), float(j)); if (cc.x < 0. || cc.x > 4. || cc.y < 0. || cc.y > 4.) continue;
    float h = hash2(cc+vI.x); vec2 l = rot(h*TAU)*(g-cc-.5-(vec2(hash2(cc+vI.x+3.), hash2(cc+vI.x+5.))-.5)*.55);
    float leaf = length(vec2(l.x*2.6, l.y))-.47+.3*abs(l.y);                                              // a pointed oval
    if (leaf < 0. && h > .3){ m = 1.; tone = h+.35*smoothstep(.0, .06, abs(l.x)); } }
  if (m < .5) discard;
  vec3 v = normalize(vW-uEye), sc = fsunC(); float toSun = pow(max(dot(v, FSUN), 0.), 2.), bandv = spec(.04+vI.w*.78), bs = specS(.04+vI.w*.78);
  vec3 dark = mix(vec3(.006,.02,.008), vec3(.05,.13,.03), vI.y)*(.35+.8*vI.z)*(.6+.6*tone);            // leaf seen by reflected light
  vec3 glowc = mix(vec3(.3,.55,.07), vec3(.8,.78,.18), tone*.6)*sc*(.06+1.3*toSun)*(.15+.85*vI.z)*vI.y;        // and by the sun coming through it
  vec3 col = dark*(.8+.6*uMidS)+glowc*(.3+1.6*bs*bs+.45*max(bandv-bs, 0.)+.3*uHitS.y*vI.y);           // each crown glows with its own band
  float dist = length(vW-uEye); col = mix(col, fogC(v), 1.-exp(-dist*.022));
  o = vec4(col, vDepth);
}`;
const FS_FOREST_BG = FSH + FOREST_FN + `
out vec4 o;
void main(){ vec3 rd = viewRay(); vec3 col = fogC(rd); float depth = 200.;
  col += fsunC()*exp(-acos(clamp(dot(rd, FSUN), -1., 1.))*3.2)*.5;                                          // the bright gap where the sun is
  if (rd.y < -.002){ float t = -uEye.y/rd.y; vec3 p = uEye+rd*t; depth = t;
    float litter = noise(vec3(p.xz*3.1, 1.))*.5+noise(vec3(p.xz*11., 4.))*.3+noise(vec3(p.xz*.6, 7.))*.2;
    float path = exp(-pow((p.x-sin(p.z*.13)*1.2)/1.1, 2.));
    vec3 g = mix(mix(vec3(.03,.045,.018), vec3(.09,.075,.035), litter), vec3(.13,.105,.06), path*.7)*(.6+.6*litter);
    // sun flecks that fall through the canopy and move with it
    float fl = smoothstep(.56,.72, noise(vec3(p.xz*.45+vec2(.75,.3)*gustAt(p)*.5, uTime*.05)))*smoothstep(.3,.7, noise(vec3(p.xz*1.6, 3.+uTime*.07)));
    g += fsunC()*g*fl*(4.+7.*spec(.1+.6*fract(p.z*.07)));
    col = mix(g*(.6+.5*uDyn), fogC(rd), 1.-exp(-t*.022)); }
  o = vec4(col, depth); }`;
// Shafts of sun standing between the trunks: thin sheets along the light, each one a band.
const VS_SHAFT = VSP + FOREST_FN + `
out vec3 vS; out float vBand;
void main(){ uint id = uint(gl_InstanceID)*4u+77u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), h4 = hashu(id+3u);
  vec3 foot = vec3((h1-.5)*(9.+18.*h2), 0., 5.+h2*42.);
  vec2 q = vec2(float(gl_VertexID == 1 || gl_VertexID == 2 || gl_VertexID == 4), float(gl_VertexID == 2 || gl_VertexID == 4 || gl_VertexID == 5));
  vec3 side = normalize(cross(FSUN, foot-uEye)), p = foot+FSUN*(q.y*24./FSUN.y)+side*(q.x-.5)*(.9+1.6*h3);
  vS = vec3(q, length(foot-uEye)); vBand = h4; gl_Position = uVP*vec4(p, 1.); }`;
const FS_SHAFT = FSH + FOREST_FN + `
in vec3 vS; in float vBand; out vec4 o;
void main(){ float x = vS.x*2.-1., prof = exp(-x*x*3.5)*smoothstep(0., .08, vS.y)*smoothstep(1., .55, vS.y);
  float dust = .55+.45*noise(vec3(vS.x*7.+vBand*30., vS.y*3.-uTime*.08, vBand*9.));
  float b = spec(.05+vBand*.8), bs = specS(.05+vBand*.8);
  o = vec4(fsunC()*prof*dust*(.035+.55*bs*bs+.25*max(b-bs, 0.)+.08*uHitS.x)*exp(-vS.z*.018), 0.); }`;
const VS_POLLEN = VSP + FOREST_FN + `
uniform float uDpr, uFocus, uWindT; out vec3 vCol;
void main(){ uint id = uint(gl_VertexID)*4u+9u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), h4 = hashu(id+3u);
  vec3 p = vec3(mod(h1*26.+uWindT*(.4+.5*h4), 26.)-13., .3+h2*9.+.3*sin(uTime*(.3+h4)+h3*20.), 1.+h3*30.);
  gl_Position = uVP*vec4(p, 1.); float d = max(gl_Position.w, .05), size = max(1.5, abs(d-uFocus)/d*8.)*uDpr; gl_PointSize = min(size, 26.);
  float edge = smoothstep(0., 2., 13.-abs(p.x)), tw = spec(.6+.38*h4);
  vCol = fsunC()*(.5+1.5*step(.9, h4))*(.12+2.6*tw*tw+.4*uHit.z+.9*uHitS.z)*edge*(2./(size*size))*(.6+.4*sin(uTime*(1.+h1*3.)+h2*40.))*exp(-d*.03); }`;
scene({ id: 'forest', name: 'Deep Forest', from: 'Organic', kind: 'nature', group: 'organic', pal: 3, hue: () => 0,
  about: 'Tall trees in backlight: each low onset sends a gust back through the wood, every crown glows with a band of its own, the shafts of sun between the trunks are bands too, and the highs set the leaves trembling and the pollen sparkling',
  inputs: ['hist', 'spec', 'specS', 'bandE', 'hit', 'hitS', 'dyn'],
  cost: 'Moderate: about 110k triangles with alpha-tested foliage under 4× MSAA, plus depth of field. Phones: half the foliage cards and no depth of field.',
  post: { dof: { ap: 5, max: 9 }, bloom: 0.5, thr: 0.95, knee: 0.7, spread: 0.72, exp: 1.05, ca: 0.3, vig: 0.75, pulse: 0.2 },
  init() { this.bg = program(VS, FS_FOREST_BG); this.trunk = program(VS_TRUNK, FS_BARK); this.limb = program(VS_LIMB, FS_BARK); this.fol = program(VS_FOLIAGE, FS_FOLIAGE);
    this.shaft = program(VS_SHAFT, FS_SHAFT); this.pollen = program(VS_POLLEN, FS_POINT); this.windT = 0; },
  draw(F, out) {
    const t = F.time; this.windT += F.dt * (0.3 + 1.2 * A.hitLvl[0] + 0.8 * A.hitSlow[0]);
    const eye = [Math.sin(t * 0.045) * 0.6, 1.75 + Math.sin(t * 0.03) * 0.08, Math.sin(t * 0.027) * 0.8];        // a slow, small drift; the wood does the moving
    const c = camera(eye, [eye[0] * 0.3 + Math.sin(t * 0.02) * 0.6, 6.2, 16], 1.02, 0, 0.1, 400), focus = 11;
    const set = u => { F.set(u); setCam(u, c); }, inst = (prog, verts, n, extra) => { gl.useProgram(prog.p); set(prog.u); extra && extra(prog.u); gl.drawArraysInstanced(gl.TRIANGLES, 0, verts, n); };
    F.focus = focus;
    beginMS(); quad(this.bg, set);
    gl.enable(gl.DEPTH_TEST);
    inst(this.trunk, 540, FOR_TREES); inst(this.limb, 144, FOR_TREES * 3);
    inst(this.fol, 6, FOR_TREES * FOR_CARDS, u => gl.uniform1f(u.uMode, 0)); inst(this.fol, 6, FOR_FERNS, u => gl.uniform1f(u.uMode, 1));
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.colorMask(true, true, true, false);   // light is added; the depth kept in alpha is left alone
    inst(this.shaft, 6, FOR_SHAFTS);
    points(this.pollen, FOR_POLLEN, u => { set(u); gl.uniform1f(u.uDpr, F.px); gl.uniform1f(u.uFocus, focus); gl.uniform1f(u.uWindT, this.windT % 100000); });
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
  float fast=spec(band), slow=specS(band);
  return clamp(.25*fast+.3*slow+1.6*max(0.,fast-slow),0.,1.);      // the band's level, with a moderate lift on its attacks
}
const float FALL = .022, BACK = .5;                             // it strikes within one or two frames; the bead it throws up lands BACK after that
vec2 wgrad(vec2 p){                                           // the slope of the water surface at p
  vec2 g = vec2(0.); float warp = noise(vec3(p*.35, uTime*.12))*5., amp = .10+.22*uBassS;
  for (int i = 0; i < 9; i++){ float fi = float(i), ang = fi*2.399+.6, k = 1.7*pow(1.32, fi); vec2 D = vec2(cos(ang), sin(ang));
    float e=i<3?uBandE.x:(i<6?uBandE.y:uBandE.z);
    g += D*(.012+.026*amp+.052*e)*cos(k*dot(D,p)-sqrt(k*4.)*uTime*.62+warp*(.6+.2*fi)+fi*1.7); }
  for (int i = 0; i < 14; i++){ float sz = uDr[i].z, a = uDr[i].w-FALL, life = .44+.84*sz; if (sz <= 0. || a < 0. || a > life+BACK) continue;
    vec2 d = p-uDr[i].xy; float r = length(d)+1e-3, x = r-a*1.5, k = 22.-8.*sz;                          // bigger drops make broader, longer-lived rings
    float w = cos(x*k)*smoothstep(0.,.09,a)*(1.-smoothstep(life*.5, life, a))*exp(-x*x*(9.-4.*sz));
    float a2 = a-BACK, x2 = r-a2*1.5; if (a2 > 0.) w += .2*cos(x2*k)*smoothstep(0.,.12,a2)*(1.-smoothstep(life*.3, life*.7, a2))*exp(-x2*x2*9.);
    g += d/r*w*(.2+.5*sz)/(1.+r*.7); }
  return g; }
float petal(vec2 p, out vec3 pc){                              // a few petals riding the surface
  vec2 q = p+vec2(uTime*.05, uTime*.02), c = floor(q/1.7); float h = hash2(c+3.); pc = mix(vec3(1.,.82,.86), vec3(1.,.95,.8), hash2(c+9.));
  if (h < .62) return 0.;
  vec2 l = rot(h*20.+uTime*.1*(h-.8))*(q-(c+.3+.4*vec2(hash2(c+5.), hash2(c+7.)))*1.7);
  return smoothstep(.0, -.012, length(l*vec2(1., 1.9))-.07-.04*h); }
// The pool has a shore. Across the drift of the camera the bed slopes away: dry sand at your feet, a
// waterline that laps in and out with the bass, clear shallows, then deep water.
const vec2 SN = vec2(-.385, .923), SD = vec2(.923, .385);        // away from the shore, and along it
float shoreAt(vec2 p){ float al = dot(p, SD); return -1.75+.45*noise(vec3(al*.35, 3., 1.))+.18*sin(al*1.3)-.16*uBassS-.05*sin(uTime*.6+al); }
float depthAt(vec2 p){ float s = dot(p, SN)-shoreAt(p); return clamp(s*.36*(.8+.5*noise(vec3(p*.22, 2.)))+.12*(noise(vec3(p*.7, 5.))-.5)*smoothstep(0., 1., s), -.4, 2.6); }
// stones: where, how big, how tall. xy: offset from the nearest stone in units of its radius; z: its height; w: its seed (0 = none here)
vec4 stoneAt(vec2 pf){ vec2 sg = pf*1.25, sc = floor(sg); vec4 best = vec4(9., 9., 0., 0.);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 cc = sc+vec2(float(i), float(j)); float h = hash2(cc+.7); if (h < .56) continue;
    vec2 ctr = cc+.25+.5*vec2(hash2(cc+1.3), hash2(cc+2.9)), d = (sg-ctr)*vec2(1., .8+.5*hash2(cc+4.)); float r = .15+.34*(h-.56)*2.2;
    if (length(d)/r < length(best.xy)) best = vec4(d/r, r*.55, h); }
  return best; }
void main(){
  vec3 rd = viewRay(); const vec3 SUNL = vec3(.28, .51, .81);                 // the moon, low over the far water
  float ts = -uEye.y/rd.y; vec3 Ps = uEye+rd*ts; vec2 ps = Ps.xz;
  float d0 = depthAt(ps), wet = smoothstep(0., .25, d0);
  vec2 gs = wgrad(ps)*smoothstep(.0, .35, d0); vec3 n = normalize(vec3(-gs.x, 1., -gs.y));
  vec3 rr = refract(rd, n, 1./1.33);
  float path = max(d0, 0.)/max(-rr.y, .25); vec2 pf = ps+rr.xz*path;          // the point on the bed that you see: deeper water shifts it further
  float depth = max(depthAt(pf), 0.); path = depth/max(-rr.y, .25); pf = ps+rr.xz*path;
  // the bed: rippled sand and stones of different sizes, some standing clear of the water near the shore
  float rip = sin(pf.x*7.+noise(vec3(pf*1.1, 4.))*5.+pf.y*1.5);
  vec3 sand = vec3(.62,.56,.46)*(.8+.1*rip+.16*noise(vec3(pf*42., 1.)))*(.85+.3*noise(vec3(pf*.7, 6.)));
  vec4 st = stoneAt(pf); float dd = length(st.xy), stone = st.w > 0. ? smoothstep(1., .9, dd) : 0., rim = dd*dd*stone;
  vec3 sn = normalize(vec3(-st.xy, sqrt(max(1.-dd*dd, 0.))+.2));
  float shade = mix(mix(.6, 1., smoothstep(1., 1.6, length(st.xy-vec2(.1,-.12)))), .45+.75*clamp(dot(sn, normalize(vec3(.3,.5,.8))), 0., 1.), stone);
  vec3 stc = mix(vec3(.36,.36,.38), vec3(.5,.42,.34), fract(st.w*7.3))*(.65+.55*noise(vec3(pf*68., st.w)));
  vec3 bed = mix(sand, stc, stone)*shade;
  float proud = stone*smoothstep(-.02, .03, st.z*sqrt(max(1.-dd*dd, 0.))-depth);    // this much of the stone stands above the water
  // moonlight focused on the bed by the surface: strong in the shallows, fading with depth; it swells with the low end
  const float e = .02; vec2 g0 = wgrad(pf), gx = wgrad(pf+vec2(e,0.)), gy = wgrad(pf+vec2(0.,e));
  float hxx = (gx.x-g0.x)/e, hxy = (gx.y-g0.y)/e, hyy = (gy.y-g0.y)/e, c = min(depth, 1.2)*.8;
  vec3 cc3 = c*vec3(.94, 1., 1.07), det = (1.-cc3*hxx)*(1.-cc3*hyy)-cc3*cc3*hxy*hxy;
  vec3 caus = mix(vec3(1.), min(1./(abs(det)+.14), vec3(4.)), wet);
  vec3 pc; float pshadow = petal(pf-SUNL.xz*depth*.5, pc);
  vec3 hg = uHit*.3+uHitS*.7;                                                 // mostly the eased onset: light that swells, never flashes
  vec3 sun = vec3(.3,.42,.66)*(.55+.9*uBassS+.6*uHitS.x);                      // the whole bed's light follows the slow envelopes only
  vec3 col = bed*vec3(.03,.042,.075)+bed*sun*caus*.16*(1.-.6*pshadow);
  // lights under the stones. Each has its own colour and its own narrow band, so they come up one by one with
  // the notes; low, mid and high onsets strike the turquoise, violet and amber ones, strongest near the newest drop.
  vec2 cell = floor(pf/2.8); vec3 lanterns = vec3(0.), haze = vec3(0.);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec2 lc = cell+vec2(float(i), float(j)); float seed = hash2(lc+9.);
    vec2 pos = (lc+.2+.6*vec2(hash2(lc+2.), hash2(lc+4.)))*2.8, delta = pf-pos; float r2 = dot(delta, delta);
    vec3 lamp = seed < .4 ? vec3(.02,.85,.72) : (seed < .72 ? vec3(.34,.2,.98) : vec3(1.,.42,.09));
    float local = voice(.04+.91*fract(seed*7.31)), strike = seed < .4 ? hg.x : (seed < .72 ? hg.y : hg.z);
    float ph = .5+.5*sin(seed*40.+dot(pos, vec2(.7,.4)));                      // the strike reaches them unevenly
    float power = .05+2.6*local+1.7*strike*(.35+.65*ph);
    lanterns += lamp*exp(-r2*(1.6+.7*seed))*power; haze += lamp*exp(-r2*.55)*power; }
  col += lanterns*(.2+.6*caus)*(.36+stone*.58+rim*.99)*(.35+.78*shade)*(.83+.22*noise(vec3(pf*55., 2.)));
  // the water itself: it takes red first, then green, and holds a little of the coloured light as haze
  vec3 dry = bed*(vec3(.05,.065,.1)+sun*.2)+lanterns*.25*(.4+rim);
  float len = path+depth;
  col *= exp(-vec3(.75,.24,.13)*len);
  col += vec3(.004,.02,.035)*(1.-exp(-len*.8))+haze*.045*(1.-exp(-len*1.4));
  // the surface: you see through it at your feet and it turns to a mirror toward the far side
  vec3 rf = reflect(rd, n); float cosv = max(dot(n, -rd), 0.), fr = .02+.98*pow(1.-cosv, 5.);
  vec3 sky = vec3(.012,.024,.055)+vec3(.1,.16,.3)*pow(max(rf.y, 0.), .6)*.5+vec3(.5,.62,.9)*exp(-acos(clamp(dot(rf, SUNL), -1., 1.))*7.)*.5;
  col = mix(col, sky, fr*wet);
  col += vec3(.64,.8,1.)*pow(max(dot(rf, SUNL), 0.), 220.)*(1.5+1.6*hg.z)*wet;                  // the moon's glitter on the ripples; the highs sharpen it
  // stones standing proud, the dry beach, and the lapping edge between
  col = mix(col, dry, max(proud, 1.-smoothstep(-.02, .02, d0)));
  float edge = exp(-abs(d0)*38.)*(.5+.5*noise(vec3(ps*9., uTime*.5)));
  col += vec3(.4,.5,.62)*edge*(.35+.8*uBassS)+vec3(.02,.03,.05)*smoothstep(.3, 0., abs(d0))*smoothstep(-.3, 0., d0);
  float pm = petal(ps+gs*.3, pc)*wet;
  col = mix(col, pc*(vec3(.12,.14,.19)+lanterns*.3), pm);
  // the drops themselves: a streak coming down, then the bead thrown back up
  for (int i = 0; i < 14; i++){ float sz = uDr[i].z, a = uDr[i].w; if (a > FALL+BACK || sz <= 0.) continue;
    float up = a < FALL ? (1.-a/FALL)*1.5 : sz*.42*4.*((a-FALL)/BACK)*(1.-(a-FALL)/BACK), rad = (a < FALL ? .028 : .02)*(.5+.8*sz), sy = a < FALL ? 4. : 1.2;
    vec3 C = vec3(uDr[i].x, up+rad, uDr[i].y), oc = (uEye-C)*vec3(1., 1./sy, 1.), dd = normalize(rd*vec3(1., 1./sy, 1.));
    float b = dot(oc, dd), h = b*b-dot(oc, oc)+rad*rad;
    if (h > 0.){ vec3 nn = normalize((oc+dd*(-b-sqrt(h)))*vec3(1., 1./sy, 1.)); float e = 1.-max(dot(nn, -rd), 0.);
      vec3 dc = mix(vec3(.5,.66,.82), vec3(.95,.98,1.), smoothstep(-.2,.8,nn.y))*(.21+.36*e)+lanterns*.35+sun*pow(max(dot(reflect(rd, nn), SUNL), 0.), 40.)*3.;
      col = mix(col, dc, smoothstep(0., rad*rad*.4, h)*.9); }
    float ai = a-FALL; if (ai > 0. && ai < .25){ float rr = length(ps-uDr[i].xy);                           // the crown at the moment it strikes
      col += sun*exp(-pow((rr-ai*.9)/.02, 2.))*smoothstep(0., .06, ai)*(1.-ai/.25)*sz*1.2; } }
  o = vec4(col, ts+path);
}`;
scene({ id: 'shallows', name: 'Shallows', from: 'Organic', kind: 'nature', group: 'organic', pal: 0, hue: () => 0,
  about: 'A moonlit pool seen from its shore: the bed slopes from dry sand through clear shallows into deep water, with stones at every depth, some standing clear. Drops fall on the onsets and ring; lights under the stones come up one by one with their own bands and are struck by lows, mids and highs; the moon-caustics swell with the bass',
  inputs: ['spec', 'specS', 'hit (low, mid, high: n, amp, fast)', 'bandE', 'bassS'],
  cost: 'Moderate: four surface-slope evaluations a pixel (about 70 trig calls). Phones: five waves instead of nine, at reduced resolution.',
  post: { dof: { ap: 4, max: 5 }, bloom: 0.35, thr: 1.1, knee: 0.6, exp: 1.0, ca: 0.3, vig: 0.6, pulse: 0.2 },
  init() { this.p = program(VS, FS_SHALLOWS); this.dr = new Float32Array(56); this.di = 0; this.last = new Float32Array(8).fill(9);
    this.h0=A.hit[0].n; this.h1=A.hit[1].n; this.h2=A.hit[2].n; },
  draw(F, out) {
    const t = F.time, drift = [t * 0.12, t * 0.05], tgt = [drift[0], 0, drift[1] + 1.2];
    const D = this.dr, r = Math.random, drop = (x, z, size) => { D.set([tgt[0] + x, tgt[2] + z, size, 0], (this.di++ % 14) * 4); };
    for (let i = 0; i < 14; i++) D[i * 4 + 3] += F.dt;
    const H=A.hit;
    if(this.h0!==H[0].n){ this.h0=H[0].n; drop((r()-.5)*7.6,-.6+r()*5.2,.66+.32*H[0].amp); }
    if(this.h1!==H[1].n){ this.h1=H[1].n; drop((r()-.5)*8.4,-.8+r()*5.8,.38+.24*H[1].amp); }
    if(this.h2!==H[2].n){ this.h2=H[2].n; drop((r()-.5)*9.2,-1.+r()*6.2,.19+.17*H[2].amp); }
    const eye = [drift[0] + Math.sin(t * 0.06) * 0.4, 2.35, drift[1] - 3.0];              // standing at the water's edge, looking out and down
    const c = camera(eye, tgt, 0.8, Math.sin(t * 0.05) * 0.012, 0.1, 60); F.focus = Math.hypot(...sub(eye, tgt)) + 0.5;
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
      if (desktopLoops) gl.uniform2i(u.uNoisePulseCounts, 4, 8);
      gl.uniform1f(u.uTime, time); gl.uniform1f(u.uBass, A.bass); gl.uniform1f(u.uMid, A.mid); gl.uniform1f(u.uHigh, A.high); gl.uniform1f(u.uLevel, A.level);
      gl.uniform1f(u.uBassS, A.bassS); gl.uniform1f(u.uMidS, A.midS); gl.uniform1f(u.uHighS, A.highS); gl.uniform1f(u.uLevelS, A.levelS);
      gl.uniform1f(u.uKick, A.kick); gl.uniform1f(u.uKickL, A.kickL); gl.uniform1f(u.uSnare, A.snare); gl.uniform1f(u.uDyn, A.dyn); gl.uniform1f(u.uDrop, A.drop); gl.uniform1f(u.uAccent, A.accent); gl.uniform3fv(u.uHit, A.hitFast); gl.uniform3fv(u.uHitS, A.hitSlow); gl.uniform3fv(u.uBandE, A.hitLvl); gl.uniform1f(u.uSlowHead, slowU); gl.uniform1fv(u.uPulse, A.pulse);
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
