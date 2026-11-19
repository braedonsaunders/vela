// Package Vela for macOS or Linux around a Vela web release:
//   node build.mjs --ui=<web release folder> [--mac] [--linux]
// The release folder is what tools/release/build.ts packs (index.html, _expo, player, skins, ...);
// it is copied into ./ui so electron-builder ships it as resources/ui.
import { cpSync, existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
const nativeMac = process.argv.find(a => a.startsWith('--native-mac='))?.slice(13);
const nativeLinux = process.argv.find(a => a.startsWith('--native-linux='))?.slice(15);
const ui = process.argv.find(a => a.startsWith('--ui='))?.slice(5);
if (!ui) throw new Error('Usage: node build.mjs --ui=<web release folder> [--mac] [--linux]');
for (const part of ['index.html', '_expo', 'player', 'skins', 'routes.json'])
  if (!existsSync(resolve(ui, part))) throw new Error(`${ui} is not a Vela web release (missing ${part})`);
const stage = output ? join(resolve(output), 'stage') : resolve('.');
mkdirSync(stage, { recursive: true });
const stagedUI = join(stage, 'ui');
if (resolve(ui) !== stagedUI) {
  rmSync(stagedUI, { recursive: true, force: true });
  cpSync(resolve(ui), stagedUI, { recursive: true, dereference: true });
}
const extraResources = [{ from: stagedUI, to: 'ui' }];
for (const [input, name] of [[nativeMac, 'native-mac'], [nativeLinux, 'native-linux']]) {
  if (!input) continue;
  if (!existsSync(resolve(input))) throw new Error(`Missing native payload: ${input}`);
  extraResources.push({ from: resolve(input), to: name });
}
// Keep optional native artifacts out of browser-only packages. Explicit payloads
// come from the platform build helper and are signed with the containing app.
const baseConfig = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).build;
const configuration = { ...baseConfig, extraResources, ...(output ? { directories: { output: resolve(output) } } : {}) };
const configPath = join(stage, 'desktop-build.json');
writeFileSync(configPath, JSON.stringify(configuration));
const targets = ['--mac', '--linux'].filter(t => process.argv.includes(t));
// VELA_MAC_SIGN_IDENTITY is a Developer ID Application identity in the keychain.
// The vela-notary keychain profile enables notarization; VELA_NOTARY_PROFILE overrides it.
// electron-builder selects the certificate type and rejects the full Keychain prefix.
const signing = process.env.VELA_MAC_SIGN_IDENTITY?.replace(/^Developer ID Application:\s*/, '').trim();
const signArgs = signing ? [
  `--config.mac.identity=${signing}`, '--config.mac.hardenedRuntime=true',
  '--config.mac.entitlements=build/entitlements.mac.plist',
  '--config.mac.entitlementsInherit=build/entitlements.mac.plist',
  '--config.forceCodeSigning=true',
] : [];
const result = spawnSync('npx', ['electron-builder', '--config', configPath, ...(targets.length ? targets : ['--' + (process.platform === 'darwin' ? 'mac' : 'linux')]), '--publish', 'never', '--config.mac.notarize=false', ...signArgs],
  { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
process.exit(result.status ?? 1);
