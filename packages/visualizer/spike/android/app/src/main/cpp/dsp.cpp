#include "dsp.h"

#include <algorithm>
#include <cmath>
#include <limits>

TapRing& tapRing() {
  static TapRing ring;
  return ring;
}

void TapRing::write(const float* s, int n, int64_t frame, int rate) {
  if (frame != end_.load(std::memory_order_relaxed) || rate != rate_.load(std::memory_order_relaxed)) {
    // A discontinuity (seek, next item, new format): nothing before `frame` belongs to this run any more.
    end_.store(frame, std::memory_order_release);
    start_.store(frame, std::memory_order_release);
    rate_.store(rate, std::memory_order_release);
  }
  for (int i = 0; i < n; i++) buf_[(frame + i) & (kSize - 1)] = s[i];
  end_.store(frame + n, std::memory_order_release);
}

void TapRing::read(int64_t end, float* out, int n) const {
  const int64_t we = end_.load(std::memory_order_acquire), ws = start_.load(std::memory_order_acquire);
  const int64_t lo = std::max(ws, we - (kSize - 16384));   // stay clear of the slots the writer may be filling
  for (int k = 0; k < n; k++) {
    const int64_t f = end - n + k;
    out[k] = (f >= lo && f < we) ? buf_[f & (kSize - 1)] : 0.f;
  }
}
