// Android: plain HTTP is allowed. Vela talks to home servers on the local network (Jellyfin and Plex
// at http://<lan-address>:<port>, the mock server in development), which Android's default network
// security policy refuses outside debug builds. Media3 uses the scoped platform HTTP DataSource.
const { withAndroidManifest, withGradleProperties } = require('expo/config-plugins');

module.exports = function withAndroidCleartext(config) {
  // Keep the native playback minimum aligned with the FFmpeg audio extension.
  config = withGradleProperties(config, (mod) => {
    mod.modResults = mod.modResults.filter(item => !['android.minSdkVersion', 'reactNativeArchitectures', 'expo.useLegacyPackaging'].includes(item.key));
    mod.modResults.push({ type: 'property', key: 'android.minSdkVersion', value: '26' });
    mod.modResults.push({ type: 'property', key: 'reactNativeArchitectures', value: process.env.VELA_ANDROID_ABI || 'armeabi-v7a,arm64-v8a,x86_64' });
    // Extract libraries so SoLoader also finds a forced ARM ABI under native translation.
    mod.modResults.push({ type: 'property', key: 'expo.useLegacyPackaging', value: 'true' });
    return mod;
  });
  return withAndroidManifest(config, (manifest) => {
    const application = manifest.modResults.manifest.application[0];
    application.$['android:usesCleartextTraffic'] = 'true';
    return manifest;
  });
};
