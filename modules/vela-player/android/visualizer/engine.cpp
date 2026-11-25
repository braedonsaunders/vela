#include "engine.h"

#include <android/log.h>

#include <algorithm>
#include <ctime>
#include <set>
#include <stdexcept>

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

Engine::Engine(std::string bundle, int width, int height, const std::string& scene, const std::string& artwork, const std::string& accent) {
  const double start = nowMs();
  ex_ = std::make_unique<GlesExecutor>();
  const auto ext = glExtensions();
  const bool cbf = ext.count("GL_EXT_color_buffer_float"), cbhf = ext.count("GL_EXT_color_buffer_half_float");
  const bool floatLinear = ext.count("GL_OES_texture_float_linear");
  ::hermes::vm::RuntimeConfig config =
      ::hermes::vm::RuntimeConfig::Builder().withES6BlockScoping(true).withMicrotaskQueue(true).build();
  rt_ = facebook::hermes::makeHermesRuntime(config);
  cmd_ = std::make_shared<NativeBuffer>(16 << 20);
  band_ = std::make_shared<NativeBuffer>(Analyser::BANDS * 4);
  wave_ = std::make_shared<NativeBuffer>(Analyser::WAVE * 4);
  freq_ = std::make_shared<NativeBuffer>(Analyser::BINS * 4);
  fastFreq_ = std::make_shared<NativeBuffer>(Analyser::FAST / 2 * sizeof(float));
  time_ = std::make_shared<NativeBuffer>(Analyser::N * 4);

  // Samples the float/half-float colour targets support (the multisampled scene buffer is RGBA16F).
  GLint maxSamples = 0, hdrSamples = 0;
  glGetIntegerv(GL_MAX_SAMPLES, &maxSamples);
  const bool hdr = cbf || cbhf;
  if (hdr) glGetInternalformativ(GL_RENDERBUFFER, GL_RGBA16F, GL_SAMPLES, 1, &hdrSamples);
  const int samples = std::max(1, std::min({4, int(maxSamples), hdr ? int(hdrSamples) : 4}));

  {
    jsi::Runtime& rt = *rt_;
    jsi::Object host(rt);
    host.setProperty(rt, "commandBuffer", jsi::ArrayBuffer(rt, cmd_));
    jsi::Function f32 = rt.global().getPropertyAsFunction(rt, "Float32Array");
    auto view = [&](const std::shared_ptr<NativeBuffer>& b) { return f32.callAsConstructor(rt, jsi::ArrayBuffer(rt, b)); };
    host.setProperty(rt, "bandDb", view(band_));
    host.setProperty(rt, "wave", view(wave_));
    host.setProperty(rt, "freq", view(freq_));
    host.setProperty(rt, "fastFreq", view(fastFreq_));
    host.setProperty(rt, "time", view(time_));
    auto def = [&](const char* name, unsigned argc, jsi::HostFunctionType fn) {
      host.setProperty(rt, name, jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, name), argc, std::move(fn)));
    };
    def("flush", 1, [this](jsi::Runtime&, const jsi::Value&, const jsi::Value* a, size_t n) -> jsi::Value {
      const int words = n ? int(a[0].asNumber()) : 0;
      if (words < 1 || words > int(cmd_->size() / 4) || !ex_->run(reinterpret_cast<const int32_t*>(cmd_->data()), words))
        throw std::runtime_error("Invalid visualizer command buffer");
      return jsi::Value::undefined();
    });
    def("link", 3, [this](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) -> jsi::Value {
      if (n < 3) throw jsi::JSError(rt, "link(id, vs, fs)");
      const int id = int(a[0].asNumber());
      const double begin = nowMs();
      const auto r = ex_->link(id, a[1].asString(rt).utf8(rt), a[2].asString(rt).utf8(rt));
      linkMs_ += nowMs() - begin;
      if (!r.ok) __android_log_print(ANDROID_LOG_WARN, "VelaVisualizer", "%s", r.log.c_str());
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
      throw jsi::JSError(rt, "canvasImage: image missing from bundled assets");
    });
    host.setProperty(rt, "artworkTint", jsi::String::createFromUtf8(rt, artwork));
    host.setProperty(rt, "accent", jsi::String::createFromUtf8(rt, accent));
    host.setProperty(rt, "width", width);
    host.setProperty(rt, "height", height);
    host.setProperty(rt, "dpr", 1);
    host.setProperty(rt, "sampleRate", 48000);
    host.setProperty(rt, "scene", jsi::String::createFromUtf8(rt, scene));
    host.setProperty(rt, "maxSamples", samples);
    // glrec answers getExtension with null only for names marked false. The framework's HDR switch is
    // EXT_color_buffer_float; on GLES the half-float extension is enough for the RGBA16F targets it renders to.
    jsi::Object exts(rt);
    exts.setProperty(rt, "EXT_color_buffer_float", hdr);
    exts.setProperty(rt, "OES_texture_float_linear", floatLinear);
    host.setProperty(rt, "extensions", std::move(exts));
    rt.global().setProperty(rt, "__host", std::move(host));

    const double eval = nowMs();
    rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(std::move(bundle)), "viz-native.js");
    viz_ = rt.global().getPropertyAsObject(rt, "__viz");
    frameFn_ = viz_->getPropertyAsFunction(rt, "frame");
    statsFn_ = viz_->getPropertyAsFunction(rt, "stats");
    resizeFn_ = viz_->getPropertyAsFunction(rt, "resize");
    requireScene(scene);
    __android_log_print(ANDROID_LOG_INFO, "VelaVisualizer", "startup scene=%s hermesAndHostMs=%.0f evalIncludingLinkMs=%.0f linkMs=%.0f",
                        scene.c_str(), eval - start, nowMs() - eval, linkMs_);
  }
}

void Engine::requireScene(const std::string& scene) {
  auto& rt = *rt_;
  auto scenes = viz_->getPropertyAsObject(rt, "scenes").asArray(rt);
  int index = int(viz_->getProperty(rt, "scene").asNumber());
  if (index < 0 || index >= int(scenes.size(rt)) ||
      scenes.getValueAtIndex(rt, index).asObject(rt).getProperty(rt, "id").asString(rt).utf8(rt) != scene)
    throw std::runtime_error("Unavailable visualizer scene: " + scene);
  auto stats = statsFn_->callWithThis(rt, *viz_).asObject(rt);
  auto broken = stats.getPropertyAsObject(rt, "broken").asArray(rt);
  for (size_t i = 0; i < broken.size(rt); i++)
    if (broken.getValueAtIndex(rt, i).asString(rt).utf8(rt) == scene)
      throw std::runtime_error("Could not initialize visualizer scene: " + scene);
}

void Engine::tint(const std::string& artwork, const std::string& accent) {
  viz_->getPropertyAsFunction(*rt_, "tint").callWithThis(*rt_, *viz_,
      jsi::String::createFromUtf8(*rt_, artwork), jsi::String::createFromUtf8(*rt_, accent));
}

void Engine::resize(int width, int height) {
  resizeFn_->callWithThis(*rt_, *viz_, width, height, 1);
}

void Engine::frame() {
  an_.process(samples(), reinterpret_cast<float*>(freq_->data()), reinterpret_cast<float*>(band_->data()), reinterpret_cast<float*>(wave_->data()));
  an_.fastSpectrum(samples(), reinterpret_cast<float*>(fastFreq_->data()));
  frameFn_->callWithThis(*rt_, *viz_, nowMs());
  if (ex_->takeGlErrors()) throw std::runtime_error("Visualizer GLES command failed");
}
