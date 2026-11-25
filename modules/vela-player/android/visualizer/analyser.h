#pragma once
#include <vector>

// AnalyserNode-equivalent (fftSize 4096, smoothing 0.55) followed by vizReduce (runtime/analyse-split.js).
class Analyser {
 public:
  static constexpr int N = 4096, BINS = N / 2, FAST = 1024, BANDS = 256, WAVE = 512;
  Analyser();
  void setRate(int rate);
  // time: the last N mono samples. Writes freqDb[BINS], and bandDb[BANDS] / wave[WAVE] through vizReduce.
  void process(const float* time, float* freqDb, float* bandDb, float* wave);

  // Unsmoothed short FFT of the trailing FAST samples of the same heard window, in dB.
  void fastSpectrum(const float* time, float* db);

 private:
  void transform(const float* time, int length);
  std::vector<float> window_, smooth_, re_, im_, cos_, sin_;
  std::vector<int> rev_, binOf_;
};

// vizReduce, line for line (exposed for a host-side check against the JS reference).
void vizReduce(const float* freq, const float* time, const int* binOf, int bands, float* outBandDb, float* outWave, int waveLen);
// The epilogue's binOf for a sample rate (host-epilogue.js __audioFormat).
void bandBins(int rate, int bands, int bins, int* binOf);
