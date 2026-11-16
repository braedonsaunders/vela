// Android: plain HTTP is allowed. Vela talks to home servers on the local network (Jellyfin and Plex
// at http://<lan-address>:<port>, the mock server in development), which Android's default network
// security policy refuses outside debug builds. Media goes through libmpv's own HTTP stack either way.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withAndroidCleartext(config) {
  return withAndroidManifest(config, (manifest) => {
    const application = manifest.modResults.manifest.application[0];
    application.$['android:usesCleartextTraffic'] = 'true';
    return manifest;
  });
};
