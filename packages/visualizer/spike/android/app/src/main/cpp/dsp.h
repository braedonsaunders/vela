// The PCM tap's ring buffer and the native DSP of runtime/PROTOCOL.md ("DSP (native, next to the PCM tap)").
#pragma once
#include <atomic>
#include <cstdint>
#include <vector>

// Mono samples indexed by media frame (the item clock in samples, as the AudioProcessor counts it). One writer
// (ExoPlayer's playback thread, through VizTap), one reader (the GL thread). Lock-free: the writer publishes the
// end of what it has written with a release store; the reader only reads well behind it.
class TapRing {
 public:
  static constexpr int kSize = 1 << 18;     // 5.9 s at 44.1 kHz: far more than AudioTrack's lead plus a window
  void write(const float* s, int n, int64_t frame, int rate);
  // The n samples ending at media frame `end` (exclusive); zeros where nothing valid is held.
  void read(int64_t end, float* out, int n) const;
  int64_t writtenEnd() const { return end_.load(std::memory_order_acquire); }
  int rate() const { return rate_.load(std::memory_order_acquire); }

 private:
  float buf_[kSize] = {};
  std::atomic<int64_t> start_{0}, end_{0};   // the contiguous run held: [start_, end_)
  std::atomic<int> rate_{0};
};
TapRing& tapRing();

// AnalyserNode-equivalent (fftSize 4096, smoothing 0.55) followed by vizReduce (runtime/analyse-split.js).
class Analyser {
 public:
  static constexpr int N = 4096, BINS = N / 2, BANDS = 256, WAVE = 512;
  Analyser();
  void setRate(int rate);
  // time: the last N mono samples. Writes freqDb[BINS], and bandDb[BANDS] / wave[WAVE] through vizReduce.
  void process(const float* time, float* freqDb, float* bandDb, float* wave);

 private:
  std::vector<float> window_, smooth_, re_, im_, cos_, sin_;
  std::vector<int> rev_, binOf_;
};

// vizReduce, line for line (exposed for a host-side check against the JS reference).
void vizReduce(const float* freq, const float* time, const int* binOf, int bands, float* outBandDb, float* outWave, int waveLen);
// The epilogue's binOf for a sample rate (host-epilogue.js __audioFormat).
void bandBins(int rate, int bands, int bins, int* binOf);
