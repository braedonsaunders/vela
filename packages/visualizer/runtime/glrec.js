'use strict';
// A WebGL2 facade that records the subset the visualizer framework uses into a flat command buffer.
//
// The framework (framework/*.js) is written against WebGL2. On the web it gets the real context. On the native
// hosts it gets this facade instead: every call is resolved against GL's binding state here, in JS, and written
// out as an explicit, self-contained command (see runtime/PROTOCOL.md). The native executor (Metal on Apple,
// GLES on Android) replays the buffer once per frame. Nothing crosses a bridge: the JS engine runs on the
// render thread and the buffer is memory both sides can see.
//
// The two calls that need an answer at once go to the host synchronously:
//   host.link(id, vs, fs)  -> { ok, log, uniforms: [{ name, type, size }] }   (Metal: precompiled table; GLES: compile)
//   host.flush(words)      -> the executor consumes words [1, words) and the buffer is reused
// and host.canvasImage(canvas) turns a 2D-canvas stand-in into an image id (text atlases).

const GLC = {
  TEXTURE_2D: 0x0DE1, TEXTURE0: 0x84C0, FRAMEBUFFER: 0x8D40, READ_FRAMEBUFFER: 0x8CA8, DRAW_FRAMEBUFFER: 0x8CA9,
  RENDERBUFFER: 0x8D41, COLOR_ATTACHMENT0: 0x8CE0, DEPTH_ATTACHMENT: 0x8D00, ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893, STATIC_DRAW: 0x88E4, DYNAMIC_DRAW: 0x88E8, STREAM_DRAW: 0x88E0,
  POINTS: 0, LINES: 1, LINE_STRIP: 3, TRIANGLES: 4, TRIANGLE_STRIP: 5,
  BYTE: 0x1400, UNSIGNED_BYTE: 0x1401, SHORT: 0x1402, UNSIGNED_SHORT: 0x1403, INT: 0x1404, UNSIGNED_INT: 0x1405, FLOAT: 0x1406, HALF_FLOAT: 0x140B,
  RED: 0x1903, RG: 0x8227, RGB: 0x1907, RGBA: 0x1908, RGBA8: 0x8058, RGBA16F: 0x881A, RGBA32F: 0x8814,
  R8: 0x8229, RG8: 0x822B, R16F: 0x822D, RG16F: 0x822F, R32F: 0x822E, RG32F: 0x8230,
  DEPTH_COMPONENT24: 0x81A6, DEPTH_COMPONENT32F: 0x8CAC, DEPTH_COMPONENT16: 0x81A5,
  TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
  NEAREST: 0x2600, LINEAR: 0x2601, LINEAR_MIPMAP_LINEAR: 0x2703, LINEAR_MIPMAP_NEAREST: 0x2701,
  CLAMP_TO_EDGE: 0x812F, REPEAT: 0x2901, MIRRORED_REPEAT: 0x8370,
  BLEND: 0x0BE2, DEPTH_TEST: 0x0B71, CULL_FACE: 0x0B44, SAMPLE_ALPHA_TO_COVERAGE: 0x809E, SCISSOR_TEST: 0x0C11, DITHER: 0x0BD0,
  ZERO: 0, ONE: 1, SRC_COLOR: 0x0300, ONE_MINUS_SRC_COLOR: 0x0301, SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303,
  DST_ALPHA: 0x0304, ONE_MINUS_DST_ALPHA: 0x0305, DST_COLOR: 0x0306, ONE_MINUS_DST_COLOR: 0x0307,
  FRONT: 0x0404, BACK: 0x0405, FRONT_AND_BACK: 0x0408, NEVER: 0x0200, LESS: 0x0201, EQUAL: 0x0202, LEQUAL: 0x0203,
  GREATER: 0x0204, GEQUAL: 0x0206, ALWAYS: 0x0207,
  COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100,
  VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82, ACTIVE_UNIFORMS: 0x8B86,
  UNPACK_ALIGNMENT: 0x0CF5, UNPACK_FLIP_Y_WEBGL: 0x9240, MAX_SAMPLES: 0x8D57, MAX_TEXTURE_SIZE: 0x0D33,
  QUERY_RESULT: 0x8866, QUERY_RESULT_AVAILABLE: 0x8867,
  FLOAT_VEC2: 0x8B50, FLOAT_VEC3: 0x8B51, FLOAT_VEC4: 0x8B52, FLOAT_MAT2: 0x8B5A, FLOAT_MAT3: 0x8B5B, FLOAT_MAT4: 0x8B5C,
  INT_VEC2: 0x8B53, BOOL: 0x8B56, SAMPLER_2D: 0x8B5E,
};

// Opcodes. Keep in step with PROTOCOL.md and every executor.
const OP = {
  TEX_CREATE: 1, TEX_DELETE: 2, TEX_IMAGE: 3, TEX_SUB: 4, TEX_PARAM: 5, TEX_MIPMAP: 6,
  FB_CREATE: 7, FB_DELETE: 8, FB_ATTACH_TEX: 9, FB_ATTACH_RB: 10, RB_CREATE: 11, RB_DELETE: 12, RB_STORAGE: 13,
  BUF_CREATE: 14, BUF_DATA: 15, VAO_CREATE: 16, VAO_ATTRIB: 17, VAO_ELEMENTS: 18,
  USE_PROGRAM: 19, UNIFORM: 20, BIND_FB: 21, VIEWPORT: 22, CLEAR: 23, STATE: 24, BIND_TEX: 25,
  DRAW: 26, DRAW_ELEMENTS: 27, BLIT: 28, PROGRAM_DELETE: 29, FRAME_END: 30, TEX_IMAGE_HOST: 31,
};
// Uniform kinds in UNIFORM: components per element, and whether the words are ints.
const UK = { f1: 1, f2: 2, f3: 3, f4: 4, i1: 5, m3: 6, m4: 7 };
// STATE flags.
const SF = { BLEND: 1, DEPTH_TEST: 2, CULL: 4, A2C: 8, DEPTH_WRITE: 16 };

function createRecordingGL(host, opts) {
  opts = opts || {};
  const buf = host.commandBuffer || new ArrayBuffer(opts.capacityBytes || (4 << 20));
  const I = new Int32Array(buf), F = new Float32Array(buf), B = new Uint8Array(buf), CAP = I.length - 64;
  let n = 1;
  const flush = () => { if (n > 1) { I[0] = n; host.flush(n); } n = 1; };
  const room = words => { if (n + words > CAP) flush(); if (words > CAP) throw new Error('glrec: a single command of ' + words + ' words does not fit'); };
  const w = v => { I[n++] = v; };
  const wf = v => { F[n++] = v; };
  // Bytes are padded to whole words; a typed array of any kind is copied as bytes.
  const bytes = src => {
    const u8 = src instanceof Uint8Array ? src : new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
    const words = (u8.byteLength + 3) >> 2; room(words + 2); w(u8.byteLength); B.set(u8, n * 4); n += words;
  };

  let nextId = 1; const id = () => nextId++;
  const obj = kind => ({ kind, id: id() });
  // ── binding state, resolved here so every command is explicit
  let unit = 0; const units = new Int32Array(32);                // texture bound to each unit
  let drawFb = 0, readFb = 0, rb = 0, arrayBuf = 0, vao = 0, prog = null;
  const vaos = new Map();                                        // vao id -> { elements }
  const st = { flags: SF.DEPTH_WRITE, src: GLC.ONE, dst: GLC.ZERO, depthFunc: GLC.LESS, cull: GLC.BACK, mask: 15 };
  let stDirty = true, fbOut = -1, vp = [0, 0, 0, 0], vpOut = null;
  const programs = new Map();                                    // id -> { uniforms, locs: Map(name -> loc) }
  let flipY = false;

  const syncFb = () => { if (fbOut !== drawFb) { room(2); w(OP.BIND_FB); w(drawFb); fbOut = drawFb; vpOut = null; } };
  const syncVp = () => { if (!vpOut || vpOut[0] !== vp[0] || vpOut[1] !== vp[1] || vpOut[2] !== vp[2] || vpOut[3] !== vp[3]) { room(5); w(OP.VIEWPORT); w(vp[0]); w(vp[1]); w(vp[2]); w(vp[3]); vpOut = vp.slice(); } };
  const syncState = () => { if (!stDirty) return; room(7); w(OP.STATE); w(st.flags); w(st.src); w(st.dst); w(st.depthFunc); w(st.cull); w(st.mask); stDirty = false; };
  const setFlag = (cap, on) => {
    const bit = cap === GLC.BLEND ? SF.BLEND : cap === GLC.DEPTH_TEST ? SF.DEPTH_TEST : cap === GLC.CULL_FACE ? SF.CULL : cap === GLC.SAMPLE_ALPHA_TO_COVERAGE ? SF.A2C : 0;
    if (!bit) return; const f = on ? st.flags | bit : st.flags & ~bit; if (f !== st.flags) { st.flags = f; stDirty = true; } };
  const texOf = t => t ? t.id : 0;
  const boundTex = () => units[unit];
  const uniform = (loc, kind, comps, data, isInt) => {
    if (!loc || !prog || loc.p !== prog.id) return;
    const count = Math.max(1, Math.floor(data.length / comps)); room(5 + count * comps);
    w(OP.UNIFORM); w(prog.id); w(loc.i); w(kind); w(count);
    if (isInt) for (let k = 0; k < count * comps; k++) w(data[k] | 0); else for (let k = 0; k < count * comps; k++) wf(data[k]);
  };
  const scratch1 = [0], scratch2 = [0, 0], scratch3 = [0, 0, 0], scratch4 = [0, 0, 0, 0];

  const gl = Object.assign(Object.create(null), GLC, {
    canvas: host.canvas || null, drawingBufferWidth: 0, drawingBufferHeight: 0,
    getExtension(name) { return host.extensions && host.extensions[name] === false ? null : (name === 'EXT_disjoint_timer_query_webgl2' ? null : {}); },
    getParameter(p) { if (p === GLC.MAX_SAMPLES) return host.maxSamples || 4; if (p === GLC.MAX_TEXTURE_SIZE) return 8192; if (p === 0x8DD5 /* GPU_DISJOINT */) return false; return 0; },
    pixelStorei(p, v) { if (p === GLC.UNPACK_FLIP_Y_WEBGL) flipY = !!v; },
    isContextLost() { return false; },

    // ── textures
    createTexture() { const t = obj('tex'); room(2); w(OP.TEX_CREATE); w(t.id); return t; },
    deleteTexture(t) { if (!t) return; room(2); w(OP.TEX_DELETE); w(t.id); for (let i = 0; i < 32; i++) if (units[i] === t.id) units[i] = 0; },
    activeTexture(u) { unit = u - GLC.TEXTURE0; },
    bindTexture(target, t) { units[unit] = texOf(t); },
    texParameteri(target, p, v) { room(4); w(OP.TEX_PARAM); w(boundTex()); w(p); w(v); },
    generateMipmap() { room(2); w(OP.TEX_MIPMAP); w(boundTex()); },
    texImage2D(target, level, ifmt, a, b, c, d, e, f) {
      if (level !== 0) return;
      if (f === undefined && e !== undefined && typeof e === 'object' && e && !ArrayBuffer.isView(e)) {   // (target, level, ifmt, fmt, type, source)
        const img = host.canvasImage(e); room(8); w(OP.TEX_IMAGE_HOST); w(boundTex()); w(ifmt); w(img.width); w(img.height); w(img.id); w(flipY ? 1 : 0); w(0); return;
      }
      const width = a, height = b, fmt = d, type = e, data = f;
      room(9); w(OP.TEX_IMAGE); w(boundTex()); w(ifmt); w(width); w(height); w(fmt); w(type); w(flipY ? 1 : 0);
      if (data) bytes(data); else w(0);
    },
    texSubImage2D(target, level, x, y, width, height, fmt, type, data) {
      room(9); w(OP.TEX_SUB); w(boundTex()); w(x); w(y); w(width); w(height); w(fmt); w(type); bytes(data);
    },

    // ── framebuffers and renderbuffers
    createFramebuffer() { const f = obj('fb'); room(2); w(OP.FB_CREATE); w(f.id); return f; },
    deleteFramebuffer(f) { if (!f) return; room(2); w(OP.FB_DELETE); w(f.id); if (drawFb === f.id) drawFb = 0; if (readFb === f.id) readFb = 0; if (fbOut === f.id) fbOut = -1; },
    bindFramebuffer(target, f) { const v = f ? f.id : 0; if (target === GLC.READ_FRAMEBUFFER) readFb = v; else if (target === GLC.DRAW_FRAMEBUFFER) drawFb = v; else { drawFb = v; readFb = v; } },
    framebufferTexture2D(target, att, tt, t) { room(4); w(OP.FB_ATTACH_TEX); w(target === GLC.READ_FRAMEBUFFER ? readFb : drawFb); w(att); w(texOf(t)); },
    framebufferRenderbuffer(target, att, rt, r) { room(4); w(OP.FB_ATTACH_RB); w(target === GLC.READ_FRAMEBUFFER ? readFb : drawFb); w(att); w(r ? r.id : 0); },
    checkFramebufferStatus() { return 0x8CD5; },
    createRenderbuffer() { const r = obj('rb'); room(2); w(OP.RB_CREATE); w(r.id); return r; },
    deleteRenderbuffer(r) { if (!r) return; room(2); w(OP.RB_DELETE); w(r.id); },
    bindRenderbuffer(t, r) { rb = r ? r.id : 0; },
    renderbufferStorageMultisample(t, samples, ifmt, width, height) { room(6); w(OP.RB_STORAGE); w(rb); w(samples); w(ifmt); w(width); w(height); },
    renderbufferStorage(t, ifmt, width, height) { room(6); w(OP.RB_STORAGE); w(rb); w(0); w(ifmt); w(width); w(height); },
    blitFramebuffer(sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter) {
      room(13); w(OP.BLIT); w(readFb); w(drawFb); w(sx0); w(sy0); w(sx1); w(sy1); w(dx0); w(dy0); w(dx1); w(dy1); w(mask); w(filter); fbOut = -1;
    },

    // ── buffers and vertex arrays (vertex array 0 is the attribute-less default)
    createBuffer() { const b = obj('buf'); room(2); w(OP.BUF_CREATE); w(b.id); return b; },
    deleteBuffer() {},
    bindBuffer(target, b) { const v = b ? b.id : 0; if (target === GLC.ELEMENT_ARRAY_BUFFER) { if (vao) { room(3); w(OP.VAO_ELEMENTS); w(vao); w(v); vaos.get(vao).elements = v; } } else arrayBuf = v; },
    bufferData(target, data, usage) {
      const b = target === GLC.ELEMENT_ARRAY_BUFFER ? (vao ? vaos.get(vao).elements : 0) : arrayBuf;
      room(4); w(OP.BUF_DATA); w(b); w(target === GLC.ELEMENT_ARRAY_BUFFER ? 1 : 0); bytes(data);
    },
    createVertexArray() { const v = obj('vao'); vaos.set(v.id, { elements: 0, attribs: new Map() }); room(2); w(OP.VAO_CREATE); w(v.id); return v; },
    deleteVertexArray() {},
    bindVertexArray(v) { vao = v ? v.id : 0; },
    enableVertexAttribArray(loc) { const a = this._attr(loc); a.on = 1; this._emitAttr(loc, a); },
    disableVertexAttribArray(loc) { const a = this._attr(loc); a.on = 0; this._emitAttr(loc, a); },
    vertexAttribPointer(loc, size, type, norm, stride, offset) { const a = this._attr(loc); Object.assign(a, { buf: arrayBuf, size, type, norm: norm ? 1 : 0, stride, offset }); this._emitAttr(loc, a); },
    vertexAttribDivisor(loc, d) { const a = this._attr(loc); a.div = d; this._emitAttr(loc, a); },
    _attr(loc) { const v = vaos.get(vao); if (!v) throw new Error('glrec: attributes need a vertex array'); let a = v.attribs.get(loc); if (!a) v.attribs.set(loc, a = { buf: 0, size: 4, type: GLC.FLOAT, norm: 0, stride: 0, offset: 0, div: 0, on: 0 }); return a; },
    _emitAttr(loc, a) { room(11); w(OP.VAO_ATTRIB); w(vao); w(loc); w(a.buf); w(a.size); w(a.type); w(a.norm); w(a.stride); w(a.offset); w(a.div); w(a.on); },

    // ── shaders and programs: linking is the one synchronous question
    createShader(type) { return { kind: 'shader', type, src: '' }; },
    shaderSource(s, src) { s.src = src; },
    compileShader() {},
    getShaderParameter() { return true; },
    getShaderInfoLog() { return ''; },
    deleteShader() {},
    createProgram() { const p = obj('prog'); p.shaders = []; return p; },
    attachShader(p, s) { p.shaders.push(s); },
    linkProgram(p) {
      const vs = p.shaders.find(s => s.type === GLC.VERTEX_SHADER), fs = p.shaders.find(s => s.type === GLC.FRAGMENT_SHADER);
      flush();                                                      // anything recorded so far runs before the program exists
      const r = host.link(p.id, vs.src, fs.src);
      p.ok = !!r.ok; p.log = r.log || ''; p.uniforms = r.uniforms || [];
      p.locs = new Map(); p.uniforms.forEach((u, i) => { const loc = { p: p.id, i }; p.locs.set(u.name, loc); p.locs.set(u.name + '[0]', loc); });
      programs.set(p.id, p);
    },
    getProgramParameter(p, q) { if (q === GLC.LINK_STATUS) return p.ok; if (q === GLC.ACTIVE_UNIFORMS) return p.uniforms.length; return 0; },
    getProgramInfoLog(p) { return p.log; },
    getActiveUniform(p, i) { const u = p.uniforms[i]; return { name: u.size > 1 ? u.name + '[0]' : u.name, type: u.type, size: u.size }; },
    getUniformLocation(p, name) { return p.locs.get(name) || null; },
    deleteProgram(p) { if (!p) return; room(2); w(OP.PROGRAM_DELETE); w(p.id); },
    useProgram(p) { prog = p; if (p) { room(2); w(OP.USE_PROGRAM); w(p.id); } },

    uniform1f(l, x) { scratch1[0] = x; uniform(l, UK.f1, 1, scratch1); },
    uniform2f(l, x, y) { scratch2[0] = x; scratch2[1] = y; uniform(l, UK.f2, 2, scratch2); },
    uniform3f(l, x, y, z) { scratch3[0] = x; scratch3[1] = y; scratch3[2] = z; uniform(l, UK.f3, 3, scratch3); },
    uniform4f(l, x, y, z, q) { scratch4[0] = x; scratch4[1] = y; scratch4[2] = z; scratch4[3] = q; uniform(l, UK.f4, 4, scratch4); },
    uniform1i(l, x) { scratch1[0] = x; uniform(l, UK.i1, 1, scratch1, true); },
    uniform1fv(l, v) { uniform(l, UK.f1, 1, v); },
    uniform2fv(l, v) { uniform(l, UK.f2, 2, v); },
    uniform3fv(l, v) { uniform(l, UK.f3, 3, v); },
    uniform4fv(l, v) { uniform(l, UK.f4, 4, v); },
    uniformMatrix3fv(l, t, v) { uniform(l, UK.m3, 9, v); },
    uniformMatrix4fv(l, t, v) { uniform(l, UK.m4, 16, v); },

    // ── fixed-function state
    enable(cap) { setFlag(cap, true); },
    disable(cap) { setFlag(cap, false); },
    blendFunc(s, d) { if (s !== st.src || d !== st.dst) { st.src = s; st.dst = d; stDirty = true; } },
    depthFunc(f) { if (f !== st.depthFunc) { st.depthFunc = f; stDirty = true; } },
    depthMask(on) { const f = on ? st.flags | SF.DEPTH_WRITE : st.flags & ~SF.DEPTH_WRITE; if (f !== st.flags) { st.flags = f; stDirty = true; } },
    cullFace(m) { if (m !== st.cull) { st.cull = m; stDirty = true; } },
    colorMask(r, g, b, a) { const m = (r ? 1 : 0) | (g ? 2 : 0) | (b ? 4 : 0) | (a ? 8 : 0); if (m !== st.mask) { st.mask = m; stDirty = true; } },
    viewport(x, y, width, height) { vp[0] = x; vp[1] = y; vp[2] = width; vp[3] = height; },
    clearColor(r, g, b, a) { this._cc = [r, g, b, a]; },
    clearDepth(d) { this._cd = d; },
    clear(mask) { syncFb(); syncVp(); const c = this._cc || [0, 0, 0, 0]; room(7); w(OP.CLEAR); w(mask); wf(c[0]); wf(c[1]); wf(c[2]); wf(c[3]); wf(this._cd === undefined ? 1 : this._cd); },

    // ── draws: textures bound to the units the program samples are sent with each draw
    drawArrays(mode, first, count) { this._draw(); room(6); w(OP.DRAW); w(mode); w(first); w(count); w(1); w(vao); },
    drawArraysInstanced(mode, first, count, inst) { this._draw(); room(6); w(OP.DRAW); w(mode); w(first); w(count); w(inst); w(vao); },
    drawElements(mode, count, type, offset) { this._draw(); room(7); w(OP.DRAW_ELEMENTS); w(mode); w(count); w(type); w(offset); w(1); w(vao); },
    drawElementsInstanced(mode, count, type, offset, inst) { this._draw(); room(7); w(OP.DRAW_ELEMENTS); w(mode); w(count); w(type); w(offset); w(inst); w(vao); },
    _draw() { syncFb(); syncVp(); syncState(); const t = this._sent || (this._sent = new Int32Array(32).fill(-1));
      for (let i = 0; i < 16; i++) if (t[i] !== units[i]) { room(3); w(OP.BIND_TEX); w(i); w(units[i]); t[i] = units[i]; } },

    // ── timing and read-back are the host's business natively
    createQuery() { return {}; }, deleteQuery() {}, beginQuery() {}, endQuery() {}, getQueryParameter() { return 0; },
    readPixels() { flush(); },
    finish() { flush(); }, flush() { flush(); },
  });
  // End of frame: present, then hand the whole frame to the executor.
  gl.__endFrame = () => { room(1); w(OP.FRAME_END); flush(); fbOut = -1; vpOut = null; stDirty = true; if (gl._sent) gl._sent.fill(-1); };
  gl.__stats = () => ({ words: n });
  return gl;
}

if (typeof module !== 'undefined') module.exports = { createRecordingGL, GLC, OP, UK, SF };
