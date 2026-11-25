// One visualizer instance on the GL thread: a Hermes runtime evaluating viz-native.js against the __host object
// of runtime/PROTOCOL.md, the GLES executor behind host.flush/host.link, and the native DSP in front of each frame.
#pragma once
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "dsp.h"
#include "executor.h"

namespace jsi = facebook::jsi;

// Memory both sides see: an ArrayBuffer in JS, a plain pointer here. No copies per frame.
struct NativeBuffer : jsi::MutableBuffer {
  explicit NativeBuffer(size_t n) : bytes(n, 0) {}
  size_t size() const override { return bytes.size(); }
  uint8_t* data() override { return bytes.data(); }
  std::vector<uint8_t> bytes;
};

struct GpuTimer;

class Engine {
 public:
  Engine(std::string bundle, int width, int height, const std::string& scene, bool gpuFinish);
  ~Engine();
  void abandonGl();                                  // the context is gone: free nothing GL-side
  void resize(int width, int height);
  // heardUs: the item-clock position being heard now (µs), or < 0 if unknown. underruns: the running count.
  void frame(int64_t heardUs, int underruns);
  void step(int delta);
  bool ok() const { return ok_; }

 private:
  void report(double now, int underruns);
  template <class F> void guarded(const char* what, F&& f);

  std::unique_ptr<facebook::hermes::HermesRuntime> rt_;
  std::unique_ptr<GlesExecutor> ex_;
  Analyser an_;
  std::shared_ptr<NativeBuffer> cmd_, band_, wave_, freq_, time_;
  std::optional<jsi::Object> viz_;
  std::optional<jsi::Function> frameFn_, statsFn_, resizeFn_, audioFmtFn_, setSceneFn_;
  std::vector<std::string> sceneIds_;
  std::string bundle_;
  std::unique_ptr<GpuTimer> gpu_;
  bool gpuFinish_ = false, ok_ = false;
  int rate_ = 0, width_ = 0, height_ = 0;

  // Measurement, reported once a second.
  double execMs_ = 0;                       // executor time inside the current frame (all flushes)
  double lastFrameAt_ = 0, windowAt_ = 0;
  int frames_ = 0, jank_ = 0, lastUnderruns_ = 0, jsErrors_ = 0, glErrors_ = 0, words_ = 0;
  double sumInterval_ = 0, maxInterval_ = 0, sumExec_ = 0, sumDsp_ = 0, sumFinish_ = 0, sumWall_ = 0, sumLead_ = 0;
  int leadN_ = 0;
};
