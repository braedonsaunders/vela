#include "analyser.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace { constexpr double pi = 3.14159265358979323846; }

void bandBins(int rate, int bands, int bins, int* binOf) {
  const double ny = rate / 2.0;
  for (int i = 0; i <= bands; i++) {
    // Math.round is floor(x + 0.5)
    const double x = std::floor(28.0 * std::pow(16000.0 / 28.0, double(i) / bands) / ny * bins + 0.5);
    binOf[i] = int(std::min<double>(bins - 1, std::max<double>(1, x)));
  }
}

void vizReduce(const float* freq, const float* time, const int* binOf, int bands, float* outBandDb, float* outWave, int waveLen) {
  for (int i = 0; i < bands; i++) {
    float m = -std::numeric_limits<float>::infinity();
    for (int b = binOf[i]; b <= std::max(binOf[i], binOf[i + 1] - 1); b++) m = std::max(m, freq[b]);
    outBandDb[i] = m;
  }
  int z = 64;
  for (int i = 64; i < 1000; i++)
    if (time[i - 1] < 0 && time[i] >= 0 && time[i + 3] > time[i]) { z = i; break; }
  for (int i = 0; i < waveLen; i++) {
    const int k = z + i * 6;
    outWave[i] = (time[k] + time[k + 1] + time[k + 2]) / 3;
  }
}

Analyser::Analyser()
    : window_(N), smooth_(BINS, 0.f), re_(N), im_(N), cos_(N / 2), sin_(N / 2), rev_(N), binOf_(BANDS + 1) {
  // Blackman, alpha 0.16, exactly as the Web Audio spec writes it (n / N, not n / (N - 1)).
  const double a0 = 0.42, a1 = 0.5, a2 = 0.08;
  for (int n = 0; n < N; n++)
    window_[n] = float(a0 - a1 * std::cos(2 * pi * n / N) + a2 * std::cos(4 * pi * n / N));
  for (int k = 0; k < N / 2; k++) { cos_[k] = float(std::cos(2 * pi * k / N)); sin_[k] = float(-std::sin(2 * pi * k / N)); }
  int bits = 0;
  while ((1 << bits) < N) bits++;
  for (int i = 0; i < N; i++) {
    int r = 0;
    for (int b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev_[i] = r;
  }
  setRate(48000);
}

void Analyser::setRate(int rate) { bandBins(rate, BANDS, BINS, binOf_.data()); }

void Analyser::transform(const float* time, int length) {
  const int stride = N / length;
  for (int i = 0; i < length; i++) {
    const int rev = rev_[i] / stride;
    re_[rev] = time[i] * window_[i * stride];
    im_[rev] = 0.f;
  }
  // Iterative radix-2 FFT.
  for (int len = 2; len <= length; len <<= 1) {
    const int half = len >> 1, step = N / len;
    for (int i = 0; i < length; i += len)
      for (int j = 0; j < half; j++) {
        const float wr = cos_[j * step], wi = sin_[j * step];
        const int a = i + j, b = a + half;
        const float xr = re_[b] * wr - im_[b] * wi, xi = re_[b] * wi + im_[b] * wr;
        re_[b] = re_[a] - xr; im_[b] = im_[a] - xi;
        re_[a] += xr; im_[a] += xi;
      }
  }
}

void Analyser::fastSpectrum(const float* time, float* db) {
  transform(time + N - FAST, FAST);
  for (int i = 0; i < FAST / 2; i++) {
    const float mag = std::sqrt(re_[i] * re_[i] + im_[i] * im_[i]) / FAST;
    db[i] = mag > 0 ? 20.f * std::log10(mag) : -std::numeric_limits<float>::infinity();
  }
}

void Analyser::process(const float* time, float* freqDb, float* bandDb, float* wave) {
  transform(time, N);
  const float inv = 1.f / N, tau = 0.55f;
  for (int k = 0; k < BINS; k++) {
    const float mag = std::sqrt(re_[k] * re_[k] + im_[k] * im_[k]) * inv;
    float s = tau * smooth_[k] + (1 - tau) * mag;
    if (!std::isfinite(s)) s = 0;
    smooth_[k] = s;
    freqDb[k] = s > 0 ? 20.f * std::log10(s) : -std::numeric_limits<float>::infinity();
  }
  vizReduce(freqDb, time, binOf_.data(), BANDS, bandDb, wave, WAVE);
}
