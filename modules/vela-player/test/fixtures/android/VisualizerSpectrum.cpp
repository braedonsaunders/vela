#include "analyser.h"
#include <array>
#include <cassert>
#include <cmath>

int main() {
  Analyser analyser;
  std::array<float, Analyser::N> pcm;
  std::array<float, Analyser::FAST / 2> db;
  // Earlier loud samples must not enter the short FFT. Bin 73 contains a 0.25-amplitude sine.
  constexpr double pi = 3.14159265358979323846;
  constexpr int bin = 73, n = Analyser::FAST;
  pcm.fill(1);
  for (int i = 0; i < n; ++i) pcm[pcm.size() - n + i] = 0.25 * std::sin(2 * pi * bin * i / n);
  analyser.fastSpectrum(pcm.data(), db.data());
  // Blackman's coefficients spread a bin-centred sine across the centre and two neighbours.
  for (int d = -2; d <= 2; ++d) {
    double weight = d == 0 ? 0.42 : std::abs(d) == 1 ? 0.25 : 0.04;
    assert(std::abs(db[bin + d] - 20 * std::log10(0.125 * weight)) < 0.002);
  }
  pcm.fill(0);
  analyser.fastSpectrum(pcm.data(), db.data());
  for (float value : db) assert(std::isinf(value) && value < 0);
}
