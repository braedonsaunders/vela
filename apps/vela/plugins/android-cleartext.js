// Android: plain HTTP is allowed. Vela talks to home servers on the local network (Jellyfin and Plex
// at http://<lan-address>:<port>, the mock server in development), which Android's default network
// security policy refuses outside debug builds. Media3 uses the scoped platform HTTP DataSource.
const { withAndroidManifest, withGradleProperties } = require('expo/config-plugins');

module.exports = function withAndroidCleartext(config) {
  // Keep the native playback minimum aligned with the FFmpeg audio extension.
  config = withGradleProperties(config, (mod) => {
    mod.modResults = mod.modResults.filter(item => item.key !== 'android.minSdkVersion');
    mod.modResults.push({ type: 'property', key: 'android.minSdkVersion', value: '26' });
    return mod;
  });
  return withAndroidManifest(config, (manifest) => {
    const application = manifest.modResults.manifest.application[0];
    application.$['android:usesCleartextTraffic'] = 'true';
    return manifest;
  });
};
