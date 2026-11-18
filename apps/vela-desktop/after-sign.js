// Notarize and staple before electron-builder creates the ZIP and DMG.
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin' || !process.env.VELA_MAC_SIGN_IDENTITY) return;
  const profile = process.env.VELA_NOTARY_PROFILE || 'vela-notary';
  const probe = spawnSync('xcrun', ['notarytool', 'history', '--keychain-profile', profile, '--output-format', 'json'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    if (!process.env.VELA_NOTARY_PROFILE && /No Keychain password item found/i.test(probe.stderr || '')) {
      console.log('Skipping notarization: store the vela-notary keychain profile to enable it.');
      return;
    }
    throw new Error(`Cannot access notarization profile ${profile}; check notarytool credentials and connectivity.`);
  }
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const temp = mkdtempSync(path.join(tmpdir(), 'vela-notary-'));
  try {
    const zip = path.join(temp, 'Vela.zip');
    execFileSync('ditto', ['-c', '-k', '--keepParent', app, zip], { stdio: 'inherit' });
    execFileSync('xcrun', ['notarytool', 'submit', zip, '--keychain-profile', profile, '--wait'], { stdio: 'inherit' });
    execFileSync('xcrun', ['stapler', 'staple', app], { stdio: 'inherit' });
    execFileSync('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' });
  } finally { rmSync(temp, { recursive: true, force: true }); }
};
