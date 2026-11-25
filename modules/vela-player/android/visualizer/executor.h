// The GLES 3.0 executor for glrec command buffers (runtime/PROTOCOL.md): runtime/replay-webgl.js in C++.
#pragma once
#include <GLES3/gl3.h>

#include <cstdint>
#include <string>
#include <vector>

class GlesExecutor {
 public:
  struct Uniform { std::string name; int type; int size; };
  struct LinkResult { bool ok = false; std::string log; std::vector<Uniform> uniforms; };

  GlesExecutor();                      // needs the GL context current
  ~GlesExecutor();                     // deletes every GL object, unless abandon() was called (context gone)
  void abandon() { abandoned_ = true; }

  LinkResult link(int id, const std::string& vs, const std::string& fs);
  // Executes words [1, words) of the buffer. Returns false (and logs) on a malformed buffer.
  bool run(const int32_t* I, int words);
  int takeGlErrors();                  // GL errors seen since the last call

 private:
  struct Program { GLuint p = 0; std::vector<GLint> locs; };
  struct State { int flags = 16, src = GL_ONE, dst = GL_ZERO, depthFunc = GL_LESS, cull = GL_BACK, mask = 15; };
  static GLuint get(const std::vector<GLuint>& v, int id) { return id > 0 && id < int(v.size()) ? v[id] : 0; }
  static void put(std::vector<GLuint>& v, int id, GLuint name) { if (id >= int(v.size())) v.resize(id + 64, 0); v[id] = name; }
  void stateOut();
  const uint8_t* flipRows(const uint8_t* data, int len, int h);

  std::vector<GLuint> tex_, fbs_, rbs_, bufs_, vaos_;
  std::vector<Program> progs_;
  GLuint defaultVao_ = 0, fb_ = 0, prog_ = 0;   // fb_: the logical framebuffer (BIND_FB); prog_: current program
  State state_;
  std::vector<uint8_t> flip_;
  bool abandoned_ = false;
  int errors_ = 0;
};
