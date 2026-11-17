// Keep signing secrets outside both the repository and the generated Android project.
// Without an upload key, Expo's development signing remains available for emulator installs.
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withAndroidSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes('// Vela upload signing')) {
      mod.modResults.contents += `
// Vela upload signing: paths and passwords are supplied only to the build process.
def velaUploadKey = System.getenv('VELA_ANDROID_KEYSTORE')
if (velaUploadKey) {
    android.signingConfigs.create('velaUpload') {
        storeFile file(velaUploadKey)
        storePassword System.getenv('VELA_ANDROID_STORE_PASSWORD')
        keyAlias System.getenv('VELA_ANDROID_KEY_ALIAS') ?: 'vela-upload'
        keyPassword System.getenv('VELA_ANDROID_KEY_PASSWORD')
    }
    android.buildTypes.release.signingConfig = android.signingConfigs.velaUpload
}
`;
    }
    return mod;
  });
};
