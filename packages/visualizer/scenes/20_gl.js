
// ═════════════════════════ 2 · Renderer: shader library and post chain ═════════════════════════
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
if (!gl) document.body.innerHTML = '<p style="padding:40px">This visualizer needs WebGL 2.</p>';
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
  const int N = 32;
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
  return { t, f, w, h };
}
const freeTarget = o => { if (o) { gl.deleteTexture(o.t); gl.deleteFramebuffer(o.f); } };
// Multisampled HDR colour + depth for the mesh scenes, resolved into the scene's own buffer.
const SAMPLES = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
function msTarget(w, h) {
  const f = gl.createFramebuffer(), c = gl.createRenderbuffer(), d = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, c); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, SAMPLES, HDR ? gl.RGBA16F : gl.RGBA8, w, h);
  gl.bindRenderbuffer(gl.RENDERBUFFER, d); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, SAMPLES, gl.DEPTH_COMPONENT24, w, h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
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
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(innerWidth * DPR), h = Math.floor(innerHeight * DPR);
  canvas.width = w; canvas.height = h;
  const k = Math.min(1, Math.sqrt(BUDGET * budgetScale / (w * h)));
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
