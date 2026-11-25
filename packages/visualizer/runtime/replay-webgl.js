'use strict';
// The reference executor: replays a glrec command buffer onto a real WebGL2 context.
// It exists to prove the protocol on the web (direct WebGL2 and record → replay must give the same pixels), and it
// is the line-by-line model for the GLES executor on Android, which is the same calls in C++.
// It also provides host.link for a GL backend: compile now, answer with the active uniforms.

function createWebGLReplayer(gl) {
  const { OP, UK, SF, GLC } = (typeof module !== 'undefined') ? require('./glrec.js') : self.VizGL;
  const tex = new Map(), fbs = new Map(), rbs = new Map(), bufs = new Map(), vaos = new Map(), progs = new Map();
  const defaultVao = gl.createVertexArray();
  let I = null, F = null, B = null, fbBound = null;

  function link(id, vsSrc, fsSrc) {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    try {
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return { ok: false, log: gl.getProgramInfoLog(p) };
      const uniforms = [], locs = [];
      for (let i = 0, k = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < k; i++) {
        const u = gl.getActiveUniform(p, i), name = u.name.replace(/\[0\]$/, '');
        uniforms.push({ name, type: u.type, size: u.size }); locs.push(gl.getUniformLocation(p, u.name));
      }
      progs.set(id, { p, locs });
      return { ok: true, log: '', uniforms };
    } catch (e) { return { ok: false, log: String(e.message || e) }; }
  }

  const readBytes = (at) => { const len = I[at]; return { len, data: new Uint8Array(B.buffer, B.byteOffset + (at + 1) * 4, len), next: at + 1 + ((len + 3) >> 2) }; };
  // Typed views a WebGL upload expects for a given type.
  const view = (type, u8) => type === GLC.FLOAT ? new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength >> 2)
    : type === GLC.HALF_FLOAT || type === GLC.UNSIGNED_SHORT ? new Uint16Array(u8.buffer, u8.byteOffset, u8.byteLength >> 1)
    : type === GLC.UNSIGNED_INT ? new Uint32Array(u8.buffer, u8.byteOffset, u8.byteLength >> 2) : u8;

  function run(buffer, words) {
    I = new Int32Array(buffer); F = new Float32Array(buffer); B = new Uint8Array(buffer);
    let k = 1;
    while (k < words) {
      const op = I[k++];
      switch (op) {
        case OP.TEX_CREATE: tex.set(I[k++], gl.createTexture()); break;
        case OP.TEX_DELETE: gl.deleteTexture(tex.get(I[k])); tex.delete(I[k++]); break;
        case OP.TEX_IMAGE: { const t = tex.get(I[k]), ifmt = I[k + 1], wd = I[k + 2], ht = I[k + 3], fmt = I[k + 4], type = I[k + 5], flip = I[k + 6]; k += 7;
          gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !!flip);
          if (I[k] === 0) { gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, wd, ht, 0, fmt, type, null); k++; }
          else { const r = readBytes(k); gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, wd, ht, 0, fmt, type, view(type, r.data)); k = r.next; }
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); break; }
        case OP.TEX_SUB: { const t = tex.get(I[k]), x = I[k + 1], y = I[k + 2], wd = I[k + 3], ht = I[k + 4], fmt = I[k + 5], type = I[k + 6]; k += 7;
          const r = readBytes(k); k = r.next; gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, wd, ht, fmt, type, view(type, r.data)); break; }
        case OP.TEX_PARAM: gl.bindTexture(gl.TEXTURE_2D, tex.get(I[k])); gl.texParameteri(gl.TEXTURE_2D, I[k + 1], I[k + 2]); k += 3; break;
        case OP.TEX_MIPMAP: gl.bindTexture(gl.TEXTURE_2D, tex.get(I[k++])); gl.generateMipmap(gl.TEXTURE_2D); break;
        case OP.TEX_IMAGE_HOST: throw new Error('replay: host images are not supported in the reference replayer');
        case OP.FB_CREATE: fbs.set(I[k++], gl.createFramebuffer()); break;
        case OP.FB_DELETE: gl.deleteFramebuffer(fbs.get(I[k])); fbs.delete(I[k++]); break;
        case OP.FB_ATTACH_TEX: gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.get(I[k])); gl.framebufferTexture2D(gl.FRAMEBUFFER, I[k + 1], gl.TEXTURE_2D, tex.get(I[k + 2]) || null, 0); k += 3; fbBound = undefined; break;
        case OP.FB_ATTACH_RB: gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.get(I[k])); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, I[k + 1], gl.RENDERBUFFER, rbs.get(I[k + 2]) || null); k += 3; fbBound = undefined; break;
        case OP.RB_CREATE: rbs.set(I[k++], gl.createRenderbuffer()); break;
        case OP.RB_DELETE: gl.deleteRenderbuffer(rbs.get(I[k])); rbs.delete(I[k++]); break;
        case OP.RB_STORAGE: gl.bindRenderbuffer(gl.RENDERBUFFER, rbs.get(I[k]));
          if (I[k + 1] > 0) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, I[k + 1], I[k + 2], I[k + 3], I[k + 4]); else gl.renderbufferStorage(gl.RENDERBUFFER, I[k + 2], I[k + 3], I[k + 4]);
          k += 5; break;
        case OP.BUF_CREATE: bufs.set(I[k++], gl.createBuffer()); break;
        case OP.BUF_DATA: { const b = bufs.get(I[k]), el = I[k + 1]; k += 2; const r = readBytes(k); k = r.next;
          const target = el ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER; gl.bindVertexArray(defaultVao);
          gl.bindBuffer(target, b); gl.bufferData(target, r.data, gl.STATIC_DRAW); if (el) gl.bindBuffer(target, null); break; }
        case OP.VAO_CREATE: vaos.set(I[k++], gl.createVertexArray()); break;
        case OP.VAO_ATTRIB: { const v = vaos.get(I[k]), loc = I[k + 1], b = bufs.get(I[k + 2]); gl.bindVertexArray(v);
          if (b) { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.vertexAttribPointer(loc, I[k + 3], I[k + 4], !!I[k + 5], I[k + 6], I[k + 7]); }
          gl.vertexAttribDivisor(loc, I[k + 8]); I[k + 9] ? gl.enableVertexAttribArray(loc) : gl.disableVertexAttribArray(loc); k += 10; break; }
        case OP.VAO_ELEMENTS: gl.bindVertexArray(vaos.get(I[k])); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.get(I[k + 1]) || null); k += 2; break;
        case OP.USE_PROGRAM: gl.useProgram(progs.get(I[k++]).p); break;
        case OP.UNIFORM: { const P = progs.get(I[k]), loc = P && P.locs[I[k + 1]], kind = I[k + 2], count = I[k + 3]; k += 4;
          const comps = kind === UK.m3 ? 9 : kind === UK.m4 ? 16 : kind === UK.i1 ? 1 : kind, nw = comps * count;
          if (loc) { gl.useProgram(P.p);
            if (kind === UK.i1) gl.uniform1iv(loc, I.subarray(k, k + nw));
            else { const v = F.subarray(k, k + nw);
              if (kind === UK.f1) gl.uniform1fv(loc, v); else if (kind === UK.f2) gl.uniform2fv(loc, v); else if (kind === UK.f3) gl.uniform3fv(loc, v);
              else if (kind === UK.f4) gl.uniform4fv(loc, v); else if (kind === UK.m3) gl.uniformMatrix3fv(loc, false, v); else gl.uniformMatrix4fv(loc, false, v); } }
          k += nw; break; }
        case OP.BIND_FB: fbBound = I[k] ? fbs.get(I[k]) : null; gl.bindFramebuffer(gl.FRAMEBUFFER, fbBound); k++; break;
        case OP.VIEWPORT: gl.viewport(I[k], I[k + 1], I[k + 2], I[k + 3]); k += 4; break;
        case OP.CLEAR: { const mask = I[k]; gl.bindFramebuffer(gl.FRAMEBUFFER, fbBound === undefined ? null : fbBound);
          gl.clearColor(F[k + 1], F[k + 2], F[k + 3], F[k + 4]); gl.clearDepth(F[k + 5]); gl.depthMask(true); gl.colorMask(true, true, true, true); gl.clear(mask); k += 6; stateOut(); break; }
        case OP.STATE: state = { flags: I[k], src: I[k + 1], dst: I[k + 2], depthFunc: I[k + 3], cull: I[k + 4], mask: I[k + 5] }; k += 6; stateOut(); break;
        case OP.BIND_TEX: gl.activeTexture(gl.TEXTURE0 + I[k]); gl.bindTexture(gl.TEXTURE_2D, tex.get(I[k + 1]) || null); k += 2; break;
        case OP.DRAW: gl.bindVertexArray(I[k + 4] ? vaos.get(I[k + 4]) : defaultVao); gl.drawArraysInstanced(I[k], I[k + 1], I[k + 2], I[k + 3]); k += 5; break;
        case OP.DRAW_ELEMENTS: gl.bindVertexArray(vaos.get(I[k + 5])); gl.drawElementsInstanced(I[k], I[k + 1], I[k + 2], I[k + 3], I[k + 4]); k += 6; break;
        case OP.BLIT: gl.bindFramebuffer(gl.READ_FRAMEBUFFER, I[k] ? fbs.get(I[k]) : null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, I[k + 1] ? fbs.get(I[k + 1]) : null);
          gl.blitFramebuffer(I[k + 2], I[k + 3], I[k + 4], I[k + 5], I[k + 6], I[k + 7], I[k + 8], I[k + 9], I[k + 10], I[k + 11]); k += 12;
          gl.bindFramebuffer(gl.FRAMEBUFFER, null); fbBound = undefined; break;
        case OP.PROGRAM_DELETE: { const P = progs.get(I[k]); if (P) gl.deleteProgram(P.p); progs.delete(I[k++]); break; }
        case OP.FRAME_END: break;
        default: throw new Error('replay: unknown opcode ' + op + ' at word ' + (k - 1));
      }
    }
  }
  let state = { flags: SF.DEPTH_WRITE, src: 1, dst: 0, depthFunc: GLC.LESS, cull: GLC.BACK, mask: 15 };
  function stateOut() {
    const s = state, en = (cap, on) => on ? gl.enable(cap) : gl.disable(cap);
    en(gl.BLEND, s.flags & SF.BLEND); en(gl.DEPTH_TEST, s.flags & SF.DEPTH_TEST); en(gl.CULL_FACE, s.flags & SF.CULL); en(gl.SAMPLE_ALPHA_TO_COVERAGE, s.flags & SF.A2C);
    gl.depthMask(!!(s.flags & SF.DEPTH_WRITE)); gl.blendFunc(s.src, s.dst); gl.depthFunc(s.depthFunc); gl.cullFace(s.cull);
    gl.colorMask(!!(s.mask & 1), !!(s.mask & 2), !!(s.mask & 4), !!(s.mask & 8));
  }
  return { link, run };
}

if (typeof module !== 'undefined') module.exports = { createWebGLReplayer };
