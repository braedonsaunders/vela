// Line-by-line port of runtime/replay-webgl.js. Two deliberate differences, both about GL binding state the
// reference leaves wrong in edge cases:
//  - FB_ATTACH_* and BLIT bind other framebuffers to do their work; afterwards the logical framebuffer (the last
//    BIND_FB) is bound again. The reference leaves the attached one bound (and CLEAR then binds the screen), so a
//    target created between two draws to the same framebuffer would send the second draw to the wrong place,
//    because glrec only re-sends BIND_FB when the framebuffer changes.
//  - GLES has no UNPACK_FLIP_Y: flipped uploads are flipped on the CPU.
#include "executor.h"

#include <android/log.h>

#include <cstring>

#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, "VizExec", __VA_ARGS__)

namespace {
enum Op {
  TEX_CREATE = 1, TEX_DELETE, TEX_IMAGE, TEX_SUB, TEX_PARAM, TEX_MIPMAP, FB_CREATE, FB_DELETE, FB_ATTACH_TEX,
  FB_ATTACH_RB, RB_CREATE, RB_DELETE, RB_STORAGE, BUF_CREATE, BUF_DATA, VAO_CREATE, VAO_ATTRIB, VAO_ELEMENTS,
  USE_PROGRAM, UNIFORM, BIND_FB, VIEWPORT, CLEAR, STATE, BIND_TEX, DRAW, DRAW_ELEMENTS, BLIT, PROGRAM_DELETE,
  FRAME_END, TEX_IMAGE_HOST,
};
enum UK { F1 = 1, F2, F3, F4, I1, M3, M4 };
enum SF { BLEND = 1, DEPTH_TEST = 2, CULL = 4, A2C = 8, DEPTH_WRITE = 16 };
inline int bytesWords(int len) { return (len + 3) >> 2; }
}  // namespace

GlesExecutor::GlesExecutor() { glGenVertexArrays(1, &defaultVao_); }

GlesExecutor::~GlesExecutor() {
  if (abandoned_) return;
  auto del = [](std::vector<GLuint>& v, void (*f)(GLsizei, const GLuint*)) { for (GLuint n : v) if (n) f(1, &n); v.clear(); };
  del(tex_, glDeleteTextures); del(fbs_, glDeleteFramebuffers); del(rbs_, glDeleteRenderbuffers);
  del(bufs_, glDeleteBuffers); del(vaos_, glDeleteVertexArrays);
  for (auto& p : progs_) if (p.p) glDeleteProgram(p.p);
  glDeleteVertexArrays(1, &defaultVao_);
}

int GlesExecutor::takeGlErrors() {
  for (GLenum e; (e = glGetError()) != GL_NO_ERROR;) {
    if (errors_ < 20) LOGW("GL error 0x%x", e);
    errors_++;
  }
  int n = errors_;
  errors_ = 0;
  return n;
}

GlesExecutor::LinkResult GlesExecutor::link(int id, const std::string& vsSrc, const std::string& fsSrc) {
  LinkResult r;
  auto compile = [&](GLenum type, const std::string& src) -> GLuint {
    GLuint s = glCreateShader(type);
    const char* p = src.c_str();
    glShaderSource(s, 1, &p, nullptr);
    glCompileShader(s);
    GLint ok = 0;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
      GLint len = 0; glGetShaderiv(s, GL_INFO_LOG_LENGTH, &len);
      std::string log(std::max(len, 1), '\0'); glGetShaderInfoLog(s, len, nullptr, log.data());
      r.log += (type == GL_VERTEX_SHADER ? "vertex: " : "fragment: ") + log;
      glDeleteShader(s);
      return 0;
    }
    return s;
  };
  GLuint vs = compile(GL_VERTEX_SHADER, vsSrc), fs = vs ? compile(GL_FRAGMENT_SHADER, fsSrc) : 0;
  if (!vs || !fs) { if (vs) glDeleteShader(vs); return r; }
  GLuint p = glCreateProgram();
  glAttachShader(p, vs); glAttachShader(p, fs); glLinkProgram(p);
  glDeleteShader(vs); glDeleteShader(fs);
  GLint ok = 0;
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok) {
    GLint len = 0; glGetProgramiv(p, GL_INFO_LOG_LENGTH, &len);
    std::string log(std::max(len, 1), '\0'); glGetProgramInfoLog(p, len, nullptr, log.data());
    r.log = log;
    glDeleteProgram(p);
    return r;
  }
  Program P; P.p = p;
  GLint count = 0, maxLen = 0;
  glGetProgramiv(p, GL_ACTIVE_UNIFORMS, &count);
  glGetProgramiv(p, GL_ACTIVE_UNIFORM_MAX_LENGTH, &maxLen);
  std::vector<char> name(std::max(maxLen, 1) + 1);
  for (GLint i = 0; i < count; i++) {
    GLsizei len = 0; GLint size = 0; GLenum type = 0;
    glGetActiveUniform(p, i, GLsizei(name.size()), &len, &size, &type, name.data());
    std::string full(name.data(), len);
    P.locs.push_back(glGetUniformLocation(p, full.c_str()));
    if (full.size() > 3 && full.compare(full.size() - 3, 3, "[0]") == 0) full.resize(full.size() - 3);
    r.uniforms.push_back({full, int(type), int(size)});
  }
  if (id >= int(progs_.size())) progs_.resize(id + 64);
  if (progs_[id].p) glDeleteProgram(progs_[id].p);
  progs_[id] = std::move(P);
  r.ok = true;
  return r;
}

const uint8_t* GlesExecutor::flipRows(const uint8_t* data, int len, int h) {
  const int row = len / h;
  flip_.resize(len);
  for (int y = 0; y < h; y++) memcpy(&flip_[size_t(y) * row], data + size_t(h - 1 - y) * row, row);
  return flip_.data();
}

void GlesExecutor::stateOut() {
  const State& s = state_;
  auto en = [](GLenum cap, bool on) { on ? glEnable(cap) : glDisable(cap); };
  en(GL_BLEND, s.flags & BLEND); en(GL_DEPTH_TEST, s.flags & DEPTH_TEST); en(GL_CULL_FACE, s.flags & CULL);
  en(GL_SAMPLE_ALPHA_TO_COVERAGE, s.flags & A2C);
  glDepthMask((s.flags & DEPTH_WRITE) ? GL_TRUE : GL_FALSE);
  glBlendFunc(s.src, s.dst); glDepthFunc(s.depthFunc); glCullFace(s.cull);
  glColorMask(s.mask & 1, (s.mask >> 1) & 1, (s.mask >> 2) & 1, (s.mask >> 3) & 1);
}

bool GlesExecutor::run(const int32_t* I, int words) {
  const float* F = reinterpret_cast<const float*>(I);
  auto bytesAt = [&](int at) { return reinterpret_cast<const uint8_t*>(I + at + 1); };
  int k = 1;
  while (k < words) {
    const int op = I[k++];
    switch (op) {
      case TEX_CREATE: { GLuint t; glGenTextures(1, &t); put(tex_, I[k++], t); break; }
      case TEX_DELETE: { GLuint t = get(tex_, I[k]); if (t) glDeleteTextures(1, &t); put(tex_, I[k++], 0); break; }
      case TEX_IMAGE: {
        const GLuint t = get(tex_, I[k]); const int ifmt = I[k + 1], w = I[k + 2], h = I[k + 3], fmt = I[k + 4], type = I[k + 5], flip = I[k + 6];
        k += 7;
        glBindTexture(GL_TEXTURE_2D, t); glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
        const int len = I[k];
        const uint8_t* data = len ? bytesAt(k) : nullptr;
        k += 1 + bytesWords(len);
        if (data && flip && h > 1) data = flipRows(data, len, h);
        glTexImage2D(GL_TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data);
        break;
      }
      case TEX_SUB: {
        const GLuint t = get(tex_, I[k]); const int x = I[k + 1], y = I[k + 2], w = I[k + 3], h = I[k + 4], fmt = I[k + 5], type = I[k + 6];
        k += 7;
        const int len = I[k]; const uint8_t* data = bytesAt(k); k += 1 + bytesWords(len);
        glBindTexture(GL_TEXTURE_2D, t); glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
        glTexSubImage2D(GL_TEXTURE_2D, 0, x, y, w, h, fmt, type, data);
        break;
      }
      case TEX_PARAM: glBindTexture(GL_TEXTURE_2D, get(tex_, I[k])); glTexParameteri(GL_TEXTURE_2D, I[k + 1], I[k + 2]); k += 3; break;
      case TEX_MIPMAP: glBindTexture(GL_TEXTURE_2D, get(tex_, I[k++])); glGenerateMipmap(GL_TEXTURE_2D); break;
      case TEX_IMAGE_HOST: {
        // Host images (text atlases) are not part of the spike: allocate a blank texture of the right size.
        static bool warned = false;
        if (!warned) { warned = true; LOGW("TEX_IMAGE_HOST: host images are not supported in the spike"); }
        glBindTexture(GL_TEXTURE_2D, get(tex_, I[k])); glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, I[k + 2], I[k + 3], 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
        k += 7;
        break;
      }
      case FB_CREATE: { GLuint f; glGenFramebuffers(1, &f); put(fbs_, I[k++], f); break; }
      case FB_DELETE: {
        GLuint f = get(fbs_, I[k]);
        if (f) { if (f == fb_) fb_ = 0; glDeleteFramebuffers(1, &f); }
        put(fbs_, I[k++], 0);
        break;
      }
      case FB_ATTACH_TEX:
        glBindFramebuffer(GL_FRAMEBUFFER, get(fbs_, I[k]));
        glFramebufferTexture2D(GL_FRAMEBUFFER, I[k + 1], GL_TEXTURE_2D, get(tex_, I[k + 2]), 0);
        glBindFramebuffer(GL_FRAMEBUFFER, fb_);
        k += 3;
        break;
      case FB_ATTACH_RB:
        glBindFramebuffer(GL_FRAMEBUFFER, get(fbs_, I[k]));
        glFramebufferRenderbuffer(GL_FRAMEBUFFER, I[k + 1], GL_RENDERBUFFER, get(rbs_, I[k + 2]));
        glBindFramebuffer(GL_FRAMEBUFFER, fb_);
        k += 3;
        break;
      case RB_CREATE: { GLuint r; glGenRenderbuffers(1, &r); put(rbs_, I[k++], r); break; }
      case RB_DELETE: { GLuint r = get(rbs_, I[k]); if (r) glDeleteRenderbuffers(1, &r); put(rbs_, I[k++], 0); break; }
      case RB_STORAGE:
        glBindRenderbuffer(GL_RENDERBUFFER, get(rbs_, I[k]));
        if (I[k + 1] > 0) glRenderbufferStorageMultisample(GL_RENDERBUFFER, I[k + 1], I[k + 2], I[k + 3], I[k + 4]);
        else glRenderbufferStorage(GL_RENDERBUFFER, I[k + 2], I[k + 3], I[k + 4]);
        k += 5;
        break;
      case BUF_CREATE: { GLuint b; glGenBuffers(1, &b); put(bufs_, I[k++], b); break; }
      case BUF_DATA: {
        const GLuint b = get(bufs_, I[k]); const int el = I[k + 1]; k += 2;
        const int len = I[k]; const uint8_t* data = bytesAt(k); k += 1 + bytesWords(len);
        const GLenum target = el ? GL_ELEMENT_ARRAY_BUFFER : GL_ARRAY_BUFFER;
        glBindVertexArray(defaultVao_);
        glBindBuffer(target, b); glBufferData(target, len, data, GL_STATIC_DRAW);
        if (el) glBindBuffer(target, 0);
        break;
      }
      case VAO_CREATE: { GLuint v; glGenVertexArrays(1, &v); put(vaos_, I[k++], v); break; }
      case VAO_ATTRIB: {
        const GLuint loc = I[k + 1], b = get(bufs_, I[k + 2]);
        glBindVertexArray(get(vaos_, I[k]));
        if (b) {
          glBindBuffer(GL_ARRAY_BUFFER, b);
          glVertexAttribPointer(loc, I[k + 3], I[k + 4], I[k + 5] ? GL_TRUE : GL_FALSE, I[k + 6], reinterpret_cast<const void*>(intptr_t(I[k + 7])));
        }
        glVertexAttribDivisor(loc, I[k + 8]);
        I[k + 9] ? glEnableVertexAttribArray(loc) : glDisableVertexAttribArray(loc);
        k += 10;
        break;
      }
      case VAO_ELEMENTS: glBindVertexArray(get(vaos_, I[k])); glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, get(bufs_, I[k + 1])); k += 2; break;
      case USE_PROGRAM: {
        const int id = I[k++];
        prog_ = id > 0 && id < int(progs_.size()) ? progs_[id].p : 0;
        glUseProgram(prog_);
        break;
      }
      case UNIFORM: {
        const int id = I[k], li = I[k + 1], kind = I[k + 2], count = I[k + 3];
        k += 4;
        const int comps = kind == M3 ? 9 : kind == M4 ? 16 : kind == I1 ? 1 : kind, nw = comps * count;
        const Program* P = id > 0 && id < int(progs_.size()) && progs_[id].p ? &progs_[id] : nullptr;
        const GLint loc = P && li >= 0 && li < int(P->locs.size()) ? P->locs[li] : -1;
        if (loc >= 0) {
          if (prog_ != P->p) { prog_ = P->p; glUseProgram(prog_); }
          const float* v = F + k;
          switch (kind) {
            case I1: glUniform1iv(loc, count, I + k); break;
            case F1: glUniform1fv(loc, count, v); break;
            case F2: glUniform2fv(loc, count, v); break;
            case F3: glUniform3fv(loc, count, v); break;
            case F4: glUniform4fv(loc, count, v); break;
            case M3: glUniformMatrix3fv(loc, count, GL_FALSE, v); break;
            default: glUniformMatrix4fv(loc, count, GL_FALSE, v); break;
          }
        }
        k += nw;
        break;
      }
      case BIND_FB: fb_ = get(fbs_, I[k++]); glBindFramebuffer(GL_FRAMEBUFFER, fb_); break;
      case VIEWPORT: glViewport(I[k], I[k + 1], I[k + 2], I[k + 3]); k += 4; break;
      case CLEAR:
        glClearColor(F[k + 1], F[k + 2], F[k + 3], F[k + 4]); glClearDepthf(F[k + 5]);
        glDepthMask(GL_TRUE); glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
        glClear(I[k]);
        k += 6;
        stateOut();
        break;
      case STATE:
        state_ = {I[k], I[k + 1], I[k + 2], I[k + 3], I[k + 4], I[k + 5]};
        k += 6;
        stateOut();
        break;
      case BIND_TEX: glActiveTexture(GL_TEXTURE0 + I[k]); glBindTexture(GL_TEXTURE_2D, get(tex_, I[k + 1])); k += 2; break;
      case DRAW:
        glBindVertexArray(I[k + 4] ? get(vaos_, I[k + 4]) : defaultVao_);
        glDrawArraysInstanced(I[k], I[k + 1], I[k + 2], I[k + 3]);
        k += 5;
        break;
      case DRAW_ELEMENTS:
        glBindVertexArray(get(vaos_, I[k + 5]));
        glDrawElementsInstanced(I[k], I[k + 1], I[k + 2], reinterpret_cast<const void*>(intptr_t(I[k + 3])), I[k + 4]);
        k += 6;
        break;
      case BLIT:
        glBindFramebuffer(GL_READ_FRAMEBUFFER, get(fbs_, I[k]));
        glBindFramebuffer(GL_DRAW_FRAMEBUFFER, get(fbs_, I[k + 1]));
        glBlitFramebuffer(I[k + 2], I[k + 3], I[k + 4], I[k + 5], I[k + 6], I[k + 7], I[k + 8], I[k + 9], I[k + 10], I[k + 11]);
        glBindFramebuffer(GL_FRAMEBUFFER, fb_);
        k += 12;
        break;
      case PROGRAM_DELETE: {
        const int id = I[k++];
        if (id > 0 && id < int(progs_.size()) && progs_[id].p) {
          if (prog_ == progs_[id].p) prog_ = 0;
          glDeleteProgram(progs_[id].p);
          progs_[id] = Program();
        }
        break;
      }
      case FRAME_END: break;
      default:
        LOGW("unknown opcode %d at word %d of %d: dropping the rest of the buffer", op, k - 1, words);
        return false;
    }
  }
  return true;
}
