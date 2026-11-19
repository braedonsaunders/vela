// Without a Developer ID, the macOS app is signed ad hoc so Apple silicon runs it (Gatekeeper still
// asks the viewer to confirm the first open). With VELA_MAC_SIGN_IDENTITY configured, electron-builder signs it.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { utimesSync, existsSync, readdirSync, statSync, chmodSync } = require('node:fs');

function makeWritable(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) makeWritable(file);
    else if (entry.isFile()) chmodSync(file, statSync(file).mode | 0o200);
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // SwiftPM binary frameworks are read-only. Only mutate the packaged copy so
  // codesign can replace their upstream signatures with Vela's identity.
  makeWritable(path.join(app, 'Contents', 'Resources', 'native-mac'));
  if (!process.env.VELA_MAC_SIGN_IDENTITY)
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  // electron-builder caches ZIPs using this directory's mtime, not nested app files.
  // Rebuilding the same version must archive the newly signed app.
  const now = new Date();
  utimesSync(context.appOutDir, now, now);
};
