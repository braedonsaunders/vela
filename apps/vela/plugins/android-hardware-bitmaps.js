// expo-image decodes through Glide, which only decodes to GPU (hardware) bitmaps when the request
// allows it, and expo-image never does: every poster arrived as a mutable software bitmap. Android
// cannot cache a mutable bitmap on the GPU, so each frame uploaded every image still attached to
// the window, on screen or not; a home of rows spent 20-40 ms a frame on it on a mid-range tablet.
// Allowing hardware bitmaps on the application's request manager (the one expo-image's views use:
// it passes Glide an Activity, which Glide maps to the application) lets Glide decode them wherever
// that is safe: it still decodes software bitmaps for requests with a transformation (blurRadius).
const { withMainActivity } = require('expo/config-plugins');

module.exports = function withAndroidHardwareBitmaps(config) {
  return withMainActivity(config, mod => {
    if (mod.modResults.language !== 'kt') throw new Error('Hardware bitmaps require a Kotlin MainActivity');
    const marker = '    // Vela: GPU bitmaps for expo-image';
    if (mod.modResults.contents.includes(marker)) return mod;
    const superCreate = /^(\s*)super\.onCreate\([^)]*\)\s*$/m;
    if (!superCreate.test(mod.modResults.contents)) throw new Error('MainActivity.onCreate has no super.onCreate call');
    const code = `${marker}
    com.bumptech.glide.Glide.with(applicationContext).applyDefaultRequestOptions(
      com.bumptech.glide.request.RequestOptions()
        .set(com.bumptech.glide.load.resource.bitmap.Downsampler.ALLOW_HARDWARE_CONFIG, true))`;
    mod.modResults.contents = mod.modResults.contents.replace(superCreate, match => `${match}\n${code}`);
    return mod;
  });
};
