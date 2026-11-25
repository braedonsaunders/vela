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

#include "analyser.h"
