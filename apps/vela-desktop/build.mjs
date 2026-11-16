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
const result = spawnSync('npx', ['electron-builder', ...(targets.length ? targets : ['--' + (process.platform === 'darwin' ? 'mac' : 'linux')]), '--publish', 'never'],
  { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
process.exit(result.status ?? 1);
