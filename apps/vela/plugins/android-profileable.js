// Measurement builds only (tools/perf): VELA_PERF_PROFILEABLE=1 marks the release app profileable
// from the shell, so simpleperf can sample it on a user-build device or emulator, and adds a
// broadcast that runs Hermes's sampling profiler:
//
//   adb shell am broadcast -p app.ether.vela -a app.ether.vela.PERF_PROFILE --es op start
//   adb shell am broadcast -p app.ether.vela -a app.ether.vela.PERF_PROFILE --es op stop
//   adb pull /sdcard/Android/data/app.ether.vela/files/js.cpuprofile
//
// Release builds never set it.
const { withAndroidManifest, withMainActivity } = require('expo/config-plugins');

module.exports = function withAndroidProfileable(config) {
  if (process.env.VELA_PERF_PROFILEABLE !== '1') return config;
  config = withAndroidManifest(config, (manifest) => {
    const application = manifest.modResults.manifest.application[0];
    application.profileable = [{ $: { 'android:shell': 'true' } }];
    return manifest;
  });
  return withMainActivity(config, (mod) => {
    const superCreate = /^(\s*)super\.onCreate\([^)]*\)\s*$/m;
    if (!superCreate.test(mod.modResults.contents)) throw new Error('MainActivity.onCreate has no super.onCreate call');
    const hook = `    // Vela measurement build: Hermes sampling profiler on a broadcast (plugins/android-profileable.js).
    androidx.core.content.ContextCompat.registerReceiver(this, object : android.content.BroadcastReceiver() {
      override fun onReceive(context: android.content.Context, intent: android.content.Intent) {
        when (intent.getStringExtra("op")) {
          "start" -> com.facebook.hermes.instrumentation.HermesSamplingProfiler.enable()
          "stop" -> {
            val file = java.io.File(getExternalFilesDir(null), "js.cpuprofile")
            com.facebook.hermes.instrumentation.HermesSamplingProfiler.dumpSampledTraceToFile(file.path)
            com.facebook.hermes.instrumentation.HermesSamplingProfiler.disable()
            android.util.Log.i("VelaPerf", "profile written to " + file.path)
          }
        }
      }
    }, android.content.IntentFilter("app.ether.vela.PERF_PROFILE"), androidx.core.content.ContextCompat.RECEIVER_EXPORTED)`;
    mod.modResults.contents = mod.modResults.contents.replace(superCreate, match => `${match}\n${hook}`);
    return mod;
  });
};
