// Without a Developer ID, the macOS app is signed ad hoc so Apple silicon runs it (Gatekeeper still
// asks the viewer to confirm the first open). With VELA_MAC_SIGN_IDENTITY configured, electron-builder signs it.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || process.env.VELA_MAC_SIGN_IDENTITY) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
