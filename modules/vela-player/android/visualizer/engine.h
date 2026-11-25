// One visualizer instance on the GL thread: a Hermes runtime evaluating viz-native.js against the __host object
// of runtime/PROTOCOL.md, the GLES executor behind host.flush/host.link, and the native DSP in front of each frame.
#pragma once
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "analyser.h"
#include "executor.h"

namespace jsi = facebook::jsi;

// Memory both sides see: an ArrayBuffer in JS, a plain pointer here. No copies per frame.
struct NativeBuffer : jsi::MutableBuffer {
  explicit NativeBuffer(size_t n) : bytes(n, 0) {}
  size_t size() const override { return bytes.size(); }
  uint8_t* data() override { return bytes.data(); }
  std::vector<uint8_t> bytes;
};

class Engine {
 public:
  Engine(std::string bundle, int width, int height, const std::string& scene, const std::string& artwork, const std::string& accent);
  void tint(const std::string& artwork, const std::string& accent);
  void resize(int width, int height);
  void frame();
  float* samples() { return reinterpret_cast<float*>(time_->data()); }
  void abandonGl() { ex_->abandon(); }

 private:
  void requireScene(const std::string& scene);
  std::unique_ptr<facebook::hermes::HermesRuntime> rt_;
  std::unique_ptr<GlesExecutor> ex_;
  Analyser an_;
  double linkMs_ = 0;
  std::shared_ptr<NativeBuffer> cmd_, band_, wave_, freq_, fastFreq_, time_;
  std::optional<jsi::Object> viz_;
  std::optional<jsi::Function> frameFn_, statsFn_, resizeFn_;
};
