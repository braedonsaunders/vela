#include "engine.h"

#include <EGL/egl.h>
#include <GLES2/gl2ext.h>
#include <android/log.h>

#include <algorithm>
#include <ctime>
#include <set>

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "VizSpike", __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, "VizSpike", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "VizSpike", __VA_ARGS__)

namespace {
double nowMs() {
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec * 1e3 + ts.tv_nsec / 1e6;
}

std::set<std::string> glExtensions() {
  std::set<std::string> out;
  GLint n = 0;
  glGetIntegerv(GL_NUM_EXTENSIONS, &n);
  for (GLint i = 0; i < n; i++) if (auto* s = glGetStringi(GL_EXTENSIONS, i)) out.insert(reinterpret_cast<const char*>(s));
  return out;
}
}  // namespace

// GPU time per frame from EXT_disjoint_timer_query: one TIME_ELAPSED query around the frame, read back a few
// frames later (never waited on).
struct GpuTimer {
  PFNGLGENQUERIESEXTPROC gen = nullptr;
  PFNGLDELETEQUERIESEXTPROC del = nullptr;
  PFNGLBEGINQUERYEXTPROC beginQ = nullptr;
  PFNGLENDQUERYEXTPROC endQ = nullptr;
  PFNGLGETQUERYOBJECTUIVEXTPROC getU = nullptr;
  PFNGLGETQUERYOBJECTUI64VEXTPROC getU64 = nullptr;
  static constexpr int K = 8;
  GLuint q[K] = {};
  bool pending[K] = {};
  int at = 0, slot = -1, n = 0, disjoint = 0;
  double sumMs = 0;

  static std::unique_ptr<GpuTimer> create() {
    auto t = std::make_unique<GpuTimer>();
    t->gen = (PFNGLGENQUERIESEXTPROC)eglGetProcAddress("glGenQueriesEXT");
    t->del = (PFNGLDELETEQUERIESEXTPROC)eglGetProcAddress("glDeleteQueriesEXT");
    t->beginQ = (PFNGLBEGINQUERYEXTPROC)eglGetProcAddress("glBeginQueryEXT");
    t->endQ = (PFNGLENDQUERYEXTPROC)eglGetProcAddress("glEndQueryEXT");
    t->getU = (PFNGLGETQUERYOBJECTUIVEXTPROC)eglGetProcAddress("glGetQueryObjectuivEXT");
    t->getU64 = (PFNGLGETQUERYOBJECTUI64VEXTPROC)eglGetProcAddress("glGetQueryObjectui64vEXT");
    if (!t->gen || !t->beginQ || !t->endQ || !t->getU || !t->getU64) return nullptr;
    t->gen(K, t->q);
    return t;
  }
  void poll() {
    for (int i = 0; i < K; i++) {
      if (!pending[i]) continue;
      GLuint avail = 0;
      getU(q[i], GL_QUERY_RESULT_AVAILABLE_EXT, &avail);
      if (!avail) continue;
      GLint dj = 0;
      glGetIntegerv(GL_GPU_DISJOINT_EXT, &dj);
      GLuint64 ns = 0;
      getU64(q[i], GL_QUERY_RESULT_EXT, &ns);
      pending[i] = false;
      if (dj) { disjoint++; continue; }
      sumMs += ns / 1e6;
      n++;
    }
  }
  void begin() {
    poll();
    const int i = at % K;
    slot = pending[i] ? -1 : i;
    if (slot >= 0) beginQ(GL_TIME_ELAPSED_EXT, q[slot]);
  }
  void end() {
    if (slot < 0) return;
    endQ(GL_TIME_ELAPSED_EXT);
    pending[slot] = true;
    at++;
  }
  void free() { if (del) del(K, q); }
};

template <class F>
void Engine::guarded(const char* what, F&& f) {
  try {
    f();
  } catch (const jsi::JSError& e) {
    if (jsErrors_++ < 10) LOGE("%s: %s\n%s", what, e.getMessage().c_str(), e.getStack().c_str());
  } catch (const std::exception& e) {
    if (jsErrors_++ < 10) LOGE("%s: %s", what, e.what());
  }
}

Engine::Engine(std::string bundle, int width, int height, const std::string& scene, bool gpuFinish)
    : bundle_(std::move(bundle)), gpuFinish_(gpuFinish), width_(width), height_(height) {
  ex_ = std::make_unique<GlesExecutor>();
  const auto ext = glExtensions();
  const bool cbf = ext.count("GL_EXT_color_buffer_float"), cbhf = ext.count("GL_EXT_color_buffer_half_float"),
             timer = ext.count("GL_EXT_disjoint_timer_query"), floatLinear = ext.count("GL_OES_texture_float_linear");
  LOGI("GL: %s | %s | %s", glGetString(GL_VENDOR), glGetString(GL_RENDERER), glGetString(GL_VERSION));
  LOGI("extensions: EXT_color_buffer_float=%d EXT_color_buffer_half_float=%d EXT_disjoint_timer_query=%d OES_texture_float_linear=%d",
       cbf, cbhf, timer, floatLinear);
  if (timer) gpu_ = GpuTimer::create();
  if (!gpu_) LOGI("GPU timing: %s", gpuFinish_ ? "glFinish (debug mode)" : "unavailable (start with --ez gpuFinish true for glFinish timing)");

  ::hermes::vm::RuntimeConfig config =
      ::hermes::vm::RuntimeConfig::Builder().withES6BlockScoping(true).withMicrotaskQueue(true).build();
  rt_ = facebook::hermes::makeHermesRuntime(config);
  cmd_ = std::make_shared<NativeBuffer>(16 << 20);
  band_ = std::make_shared<NativeBuffer>(Analyser::BANDS * 4);
  wave_ = std::make_shared<NativeBuffer>(Analyser::WAVE * 4);
  freq_ = std::make_shared<NativeBuffer>(Analyser::BINS * 4);
  time_ = std::make_shared<NativeBuffer>(Analyser::N * 4);
  rate_ = tapRing().rate() > 0 ? tapRing().rate() : 48000;
  an_.setRate(rate_);

  // Samples the float/half-float colour targets support (the multisampled scene buffer is RGBA16F).
  GLint maxSamples = 0, hdrSamples = 0;
  glGetIntegerv(GL_MAX_SAMPLES, &maxSamples);
  glGetInternalformativ(GL_RENDERBUFFER, GL_RGBA16F, GL_SAMPLES, 1, &hdrSamples);
  const bool hdr = cbf || cbhf;
  const int samples = std::max(1, std::min({4, int(maxSamples), hdr ? int(hdrSamples) : 4}));
  LOGI("MSAA: max %d, RGBA16F %d -> %d", maxSamples, hdrSamples, samples);

  try {
    jsi::Runtime& rt = *rt_;
    jsi::Object host(rt);
    host.setProperty(rt, "commandBuffer", jsi::ArrayBuffer(rt, cmd_));
    jsi::Function f32 = rt.global().getPropertyAsFunction(rt, "Float32Array");
    auto view = [&](const std::shared_ptr<NativeBuffer>& b) { return f32.callAsConstructor(rt, jsi::ArrayBuffer(rt, b)); };
    host.setProperty(rt, "bandDb", view(band_));
    host.setProperty(rt, "wave", view(wave_));
    host.setProperty(rt, "freq", view(freq_));
    host.setProperty(rt, "time", view(time_));
    auto def = [&](const char* name, unsigned argc, jsi::HostFunctionType fn) {
      host.setProperty(rt, name, jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, name), argc, std::move(fn)));
    };
    def("flush", 1, [this](jsi::Runtime&, const jsi::Value&, const jsi::Value* a, size_t n) -> jsi::Value {
      const int words = n ? int(a[0].asNumber()) : 0;
      const double t0 = nowMs();
      ex_->run(reinterpret_cast<const int32_t*>(cmd_->data()), std::min(words, int(cmd_->size() / 4)));
      execMs_ += nowMs() - t0;
      words_ += words;
      return jsi::Value::undefined();
    });
    def("link", 3, [this](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) -> jsi::Value {
      if (n < 3) throw jsi::JSError(rt, "link(id, vs, fs)");
      const int id = int(a[0].asNumber());
      const auto r = ex_->link(id, a[1].asString(rt).utf8(rt), a[2].asString(rt).utf8(rt));
      if (!r.ok) LOGW("link %d failed: %s", id, r.log.c_str());
      jsi::Object o(rt);
      o.setProperty(rt, "ok", r.ok);
      o.setProperty(rt, "log", jsi::String::createFromUtf8(rt, r.log));
      jsi::Array us(rt, r.uniforms.size());
      for (size_t i = 0; i < r.uniforms.size(); i++) {
        jsi::Object u(rt);
        u.setProperty(rt, "name", jsi::String::createFromUtf8(rt, r.uniforms[i].name));
        u.setProperty(rt, "type", r.uniforms[i].type);
        u.setProperty(rt, "size", r.uniforms[i].size);
        us.setValueAtIndex(rt, i, std::move(u));
      }
      o.setProperty(rt, "uniforms", std::move(us));
      return std::move(o);
    });
    def("now", 0, [](jsi::Runtime&, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value { return nowMs(); });
    def("log", 1, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) -> jsi::Value {
      if (n) __android_log_print(ANDROID_LOG_INFO, "VizJS", "%s", a[0].toString(rt).utf8(rt).c_str());
      return jsi::Value::undefined();
    });
    def("canvasImage", 1, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
      throw jsi::JSError(rt, "canvasImage: host images are not part of the Android spike");
    });
    host.setProperty(rt, "width", width);
    host.setProperty(rt, "height", height);
    host.setProperty(rt, "dpr", 1);
    host.setProperty(rt, "sampleRate", rate_);
    host.setProperty(rt, "scene", jsi::String::createFromUtf8(rt, scene));
    host.setProperty(rt, "maxSamples", samples);
    // glrec answers getExtension with null only for names marked false. The framework's HDR switch is
    // EXT_color_buffer_float; on GLES the half-float extension is enough for the RGBA16F targets it renders to.
    jsi::Object exts(rt);
    exts.setProperty(rt, "EXT_color_buffer_float", hdr);
    exts.setProperty(rt, "OES_texture_float_linear", floatLinear);
    host.setProperty(rt, "extensions", std::move(exts));
    rt.global().setProperty(rt, "__host", std::move(host));

    const double t0 = nowMs();
    rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(bundle_), "viz-native.js");
    LOGI("viz-native.js (%zu KB) evaluated in %.0f ms (incl. first scene's links), executor %.1f ms",
         bundle_.size() / 1024, nowMs() - t0, execMs_);
    viz_ = rt.global().getPropertyAsObject(rt, "__viz");
    frameFn_ = viz_->getPropertyAsFunction(rt, "frame");
    statsFn_ = viz_->getPropertyAsFunction(rt, "stats");
    resizeFn_ = viz_->getPropertyAsFunction(rt, "resize");
    audioFmtFn_ = viz_->getPropertyAsFunction(rt, "audioFormat");
    setSceneFn_ = viz_->getPropertyAsFunction(rt, "setScene");
    jsi::Array scenes = viz_->getPropertyAsObject(rt, "scenes").asArray(rt);
    for (size_t i = 0; i < scenes.size(rt); i++)
      sceneIds_.push_back(scenes.getValueAtIndex(rt, i).asObject(rt).getProperty(rt, "id").asString(rt).utf8(rt));
    ok_ = true;
  } catch (const jsi::JSError& e) {
    LOGE("bundle: %s\n%s", e.getMessage().c_str(), e.getStack().c_str());
  } catch (const std::exception& e) {
    LOGE("bundle: %s", e.what());
  }
  bundle_.clear();
  bundle_.shrink_to_fit();
}

Engine::~Engine() {
  viz_.reset(); frameFn_.reset(); statsFn_.reset(); resizeFn_.reset(); audioFmtFn_.reset(); setSceneFn_.reset();
  rt_.reset();
  if (gpu_ && ex_) gpu_->free();
  ex_.reset();
}

void Engine::abandonGl() {
  if (ex_) ex_->abandon();
  gpu_.reset();
}

void Engine::resize(int width, int height) {
  if (!ok_ || (width == width_ && height == height_)) return;
  width_ = width; height_ = height;
  guarded("resize", [&] { resizeFn_->callWithThis(*rt_, *viz_, width, height, 1); });
}

void Engine::step(int delta) {
  if (!ok_) return;
  guarded("setScene", [&] {
    const int cur = int(viz_->getProperty(*rt_, "scene").asNumber());
    setSceneFn_->callWithThis(*rt_, *viz_, cur + delta);
  });
}

void Engine::frame(int64_t heardUs, int underruns) {
  if (!ok_) return;
  jsi::Runtime& rt = *rt_;
  const double t0 = nowMs();
  if (lastFrameAt_ > 0) {
    const double iv = t0 - lastFrameAt_;
    sumInterval_ += iv;
    maxInterval_ = std::max(maxInterval_, iv);
    if (iv > 25) jank_++;
  }
  lastFrameAt_ = t0;
  if (windowAt_ == 0) { windowAt_ = t0; lastUnderruns_ = underruns; }

  // DSP: the 4096 samples ending at what is heard now.
  TapRing& ring = tapRing();
  const int rate = ring.rate();
  if (rate > 0 && rate != rate_) {
    rate_ = rate;
    an_.setRate(rate);
    LOGI("audio format: %d Hz", rate);
    guarded("audioFormat", [&] { audioFmtFn_->callWithThis(rt, *viz_, rate); });
  }
  const int64_t written = ring.writtenEnd();
  int64_t end = written;
  if (heardUs >= 0) {
    end = heardUs * rate_ / 1000000;
    sumLead_ += (written - end) * 1000.0 / rate_;
    leadN_++;
  }
  auto* time = reinterpret_cast<float*>(time_->data());
  ring.read(end, time, Analyser::N);
  an_.process(time, reinterpret_cast<float*>(freq_->data()), reinterpret_cast<float*>(band_->data()), reinterpret_cast<float*>(wave_->data()));
  const double t1 = nowMs();
  sumDsp_ += t1 - t0;

  execMs_ = 0;
  if (gpu_) gpu_->begin();
  guarded("frame", [&] { frameFn_->callWithThis(rt, *viz_, t1); });
  if (gpu_) gpu_->end();
  sumExec_ += execMs_;
  if (gpuFinish_) {
    const double f0 = nowMs();
    glFinish();
    const double f1 = nowMs();
    sumFinish_ += f1 - f0;
    sumWall_ += f1 - t1;
  }
  frames_++;
  if (t0 - windowAt_ >= 1000) report(t0, underruns);
}

// Once a second, one line: the evidence for the budget (logcat tag VizSpike, parsed by tools/summarise.sh).
void Engine::report(double now, int underruns) {
  jsi::Runtime& rt = *rt_;
  double jsMs = 0, budget = 0;
  int sw = 0, sh = 0, broken = 0, scene = 0;
  guarded("stats", [&] {
    jsi::Object st = statsFn_->callWithThis(rt, *viz_).asObject(rt);
    jsMs = st.getProperty(rt, "jsMs").asNumber();
    budget = st.getProperty(rt, "budget").asNumber();
    jsi::Array res = st.getPropertyAsObject(rt, "res").asArray(rt);
    sw = int(res.getValueAtIndex(rt, 0).asNumber());
    sh = int(res.getValueAtIndex(rt, 1).asNumber());
    broken = int(st.getPropertyAsObject(rt, "broken").asArray(rt).size(rt));
    scene = int(viz_->getProperty(rt, "scene").asNumber());
  });
  glErrors_ += ex_->takeGlErrors();
  const int n = std::max(frames_, 1);
  const double secs = (now - windowAt_) / 1000, exec = sumExec_ / n;
  char gpu[96];
  if (gpu_ && gpu_->n) snprintf(gpu, sizeof gpu, "gpu=%.2f(timer,%d)", gpu_->sumMs / gpu_->n, gpu_->n);
  else if (gpuFinish_) snprintf(gpu, sizeof gpu, "gpu=finish:%.2f wall:%.2f", sumFinish_ / n, sumWall_ / n);
  else snprintf(gpu, sizeof gpu, "gpu=n/a");
  LOGI("STAT scene=%s fps=%.1f interval=%.2f max=%.1f jank=%d js=%.2f jsOnly=%.2f exec=%.2f dsp=%.3f %s res=%dx%d budget=%.2f "
       "underruns=%d(+%d) lead=%.0fms words=%d glErr=%d jsErr=%d broken=%d",
       scene >= 0 && scene < int(sceneIds_.size()) ? sceneIds_[scene].c_str() : "?", frames_ / secs,
       sumInterval_ / n, maxInterval_, jank_, jsMs, jsMs - exec, exec, sumDsp_ / n, gpu, sw, sh, budget,
       underruns, underruns - lastUnderruns_, leadN_ ? sumLead_ / leadN_ : -1.0, words_ / n, glErrors_, jsErrors_, broken);
  if (gpu_) { gpu_->sumMs = 0; gpu_->n = 0; }
  frames_ = jank_ = words_ = glErrors_ = leadN_ = 0;
  sumInterval_ = maxInterval_ = sumExec_ = sumDsp_ = sumFinish_ = sumWall_ = sumLead_ = 0;
  lastUnderruns_ = underruns;
  windowAt_ = now;
}
