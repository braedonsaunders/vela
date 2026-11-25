
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
  for (let i = 0, n = o.iters || 18; i < n; i++) {
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
