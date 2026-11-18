// Notarize and staple before electron-builder creates the ZIP and DMG.
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin' || !process.env.VELA_MAC_SIGN_IDENTITY || !process.env.VELA_NOTARY_PROFILE) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const temp = mkdtempSync(path.join(tmpdir(), 'vela-notary-'));
  try {
    const zip = path.join(temp, 'Vela.zip');
    execFileSync('ditto', ['-c', '-k', '--keepParent', app, zip], { stdio: 'inherit' });
    execFileSync('xcrun', ['notarytool', 'submit', zip, '--keychain-profile', process.env.VELA_NOTARY_PROFILE, '--wait'], { stdio: 'inherit' });
    execFileSync('xcrun', ['stapler', 'staple', app], { stdio: 'inherit' });
    execFileSync('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' });
  } finally { rmSync(temp, { recursive: true, force: true }); }
};
