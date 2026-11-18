// Without a Developer ID, the macOS app is signed ad hoc so Apple silicon runs it (Gatekeeper still
// asks the viewer to confirm the first open). With VELA_MAC_SIGN_IDENTITY configured, electron-builder signs it.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { utimesSync } = require('node:fs');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!process.env.VELA_MAC_SIGN_IDENTITY)
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  // electron-builder caches ZIPs using this directory's mtime, not nested app files.
  // Rebuilding the same version must archive the newly signed app.
  const now = new Date();
  utimesSync(context.appOutDir, now, now);
};
