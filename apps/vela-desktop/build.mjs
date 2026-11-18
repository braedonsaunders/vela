// Package Vela for macOS or Linux around a Vela web release:
//   node build.mjs --ui=<web release folder> [--mac] [--linux]
// The release folder is what tools/release/build.ts packs (index.html, _expo, player, skins, ...);
// it is copied into ./ui so electron-builder ships it as resources/ui.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ui = process.argv.find(a => a.startsWith('--ui='))?.slice(5);
if (!ui) throw new Error('Usage: node build.mjs --ui=<web release folder> [--mac] [--linux]');
for (const part of ['index.html', '_expo', 'player', 'skins', 'routes.json'])
  if (!existsSync(resolve(ui, part))) throw new Error(`${ui} is not a Vela web release (missing ${part})`);
rmSync('ui', { recursive: true, force: true });
cpSync(resolve(ui), 'ui', { recursive: true, dereference: true });
const targets = ['--mac', '--linux'].filter(t => process.argv.includes(t));
// VELA_MAC_SIGN_IDENTITY is a Developer ID Application identity in the keychain.
// VELA_NOTARY_PROFILE=vela-notary opts into notarization after signing.
const signing = process.env.VELA_MAC_SIGN_IDENTITY;
const signArgs = signing ? [
  `--config.mac.identity=${signing}`, '--config.mac.hardenedRuntime=true',
  '--config.mac.entitlements=build/entitlements.mac.plist',
  '--config.mac.entitlementsInherit=build/entitlements.mac.plist',
  '--config.forceCodeSigning=true',
] : [];
const result = spawnSync('npx', ['electron-builder', ...(targets.length ? targets : ['--' + (process.platform === 'darwin' ? 'mac' : 'linux')]), '--publish', 'never', '--config.mac.notarize=false', ...signArgs],
  { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
process.exit(result.status ?? 1);
