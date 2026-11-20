/** One committed Expo SPA. Build only: never signs or publishes. */
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { inventory, sha256 } from './inventory';
import { stagePlayerAssets } from './player-assets';
import { capture, run } from './snapshot';
import { pwaIcons, writePwaAssets } from './pwa-assets';

if (Bun.version !== '1.4.2') throw new Error('Release builds require the pinned Bun 1.4.2 toolchain');
const root = resolve(import.meta.dir, '../..');
const args = process.argv.slice(2);
const playerInput = args.find(arg => arg.startsWith('--player-assets='))?.slice('--player-assets='.length);
if (!playerInput || args.some(arg => arg !== '--committed' && !arg.startsWith('--player-assets='))) {
  throw new Error('Usage: bun tools/release/build.ts --player-assets=<verified payload directory> [--committed]');
}
// Bulky intermediates and finalized artifacts stay on the shared scratch drive.
const scratch = join(homedir(), '.scratch/vela-build', root.split('/').at(-1)!);
await mkdir(scratch, { recursive: true });
const artifacts = join(root, '.artifacts');
const artifactsStat = await lstat(artifacts).catch(() => null);
if (!artifactsStat?.isSymbolicLink()) {
  throw new Error('Before building, make .artifacts a symlink into ~/.scratch/vela-build/<worktree>/');
}
const output = join(artifacts, 'release');
await mkdir(output, { recursive: true });
const work = await mkdtemp(join(scratch, '.expo-release-'));
try {
  const { source, revision, version, env, node } = await capture(root, work, args.includes('--committed'));
  const archiveName = `vela-${version}.tar.gz`;
  const manifestName = `vela-${version}.manifest.json`;
  for (const name of [archiveName, manifestName, `${archiveName}.sha256`, `${manifestName}.sha256`]) {
    if (await Bun.file(join(output, name)).exists()) throw new Error(`${name} exists; release versions are immutable`);
  }
  const app = join(source, 'apps/vela');
  const config = JSON.parse(await readFile(join(app, 'app.json'), 'utf8'));
  if (config.expo.web.output !== 'single') throw new Error('Release requires Expo single SPA output');
  const dist = join(work, 'export');
  const payload = join(work, 'payload');
  await mkdir(payload);
  const playerAssets = await stagePlayerAssets(playerInput, payload, revision);
  console.log(await run([process.execPath, 'install', '--frozen-lockfile'], source, env));
  const buildEnv = {
    ...env,
    NODE_ENV: 'production',
    VELA_WEB_BASE: '/vela',
    EXPO_PUBLIC_VELA_APP_VERSION: version,
    EXPO_PUBLIC_VELA_PLAYER_ASSETS: playerAssets.digest,
  };
  console.log(await run([process.execPath, 'apps/vela/scripts/assets.ts'], source, buildEnv));
  const routes = JSON.parse(await run([process.execPath, 'apps/vela/scripts/routes.ts', '/vela'], source, buildEnv));
  if (routes.schema !== 1 || routes.base !== '/vela' || !Array.isArray(routes.routes)
    || !routes.routes.includes('/vela') || routes.routes.some((path: string) =>
      typeof path !== 'string' || !(path === '/vela' || path.startsWith('/vela/')))) {
    throw new Error('Invalid app-owned route table');
  }
  const skinRenderer = JSON.parse(await run([process.execPath, 'tools/skin-renderer.ts'], source, buildEnv));
  if (skinRenderer.schema !== 1 || !Number.isSafeInteger(skinRenderer.version)
    || !/^[a-f0-9]{64}$/.test(skinRenderer.digest)) throw new Error('Invalid React renderer identity');
  // Invoke the captured workspace CLI directly: bun x must never download a replacement Expo.
  await run([node, join(source, 'node_modules/expo/bin/cli'), 'export', '--platform', 'web',
    '--output-dir', dist], app, buildEnv);
  const html = await readFile(join(dist, 'index.html'), 'utf8');
  if (!html.includes('/vela/manifest.webmanifest') || !html.includes('/vela/pwa.js')) {
    throw new Error('App-owned Expo HTML must link manifest.webmanifest and pwa.js');
  }
  for (const obsolete of ['engines', 'engines.json', 'universal', 'app', 'runtime.js']) {
    if (await lstat(join(dist, obsolete)).catch(() => null)) {
      throw new Error(`Obsolete output in Expo export: ${obsolete}`);
    }
  }
  // Add data and shell resources; preserve every byte and path in Expo's generated graph.
  await rename(join(payload, 'player'), join(dist, 'player'));
  await rename(join(payload, 'PLAYER-ASSETS-MANIFEST.json'), join(dist, 'PLAYER-ASSETS-MANIFEST.json'));
  await run([process.execPath, 'tools/skin-documents.ts', join(dist, 'skins')], source, buildEnv);
  await writePwaAssets(dist, join(source, 'brand'));
  await copyFile(join(source, 'tools/release/pwa.js'), join(dist, 'pwa.js'));
  await writeFile(join(dist, 'routes.json'), JSON.stringify(routes, null, 2) + '\n');
  await writeFile(join(dist, 'app.version.json'), JSON.stringify({ version }) + '\n');
  await writeFile(join(dist, 'manifest.webmanifest'), JSON.stringify({
    id: '/vela', name: 'Vela', short_name: 'Vela', start_url: '/vela', scope: '/vela',
    display: 'standalone', theme_color: '#090B0E', background_color: '#090B0E', icons: pwaIcons,
  }) + '\n');
  await writeFile(join(dist, 'offline.html'), '<!doctype html><html lang="en"><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>'
    + '<style>body{background:#090B0E;color:#f2e9d6;font:18px system-ui;padding:3rem}</style>'
    + '<h1>You’re offline</h1><p>Reconnect to browse and play.</p><a href="/vela">Try again</a></html>');
  const staticFiles = await inventory(dist);
  const shell = {
    version, digest: sha256(JSON.stringify(staticFiles)), offlineUrl: '/vela/offline.html', routes: routes.routes,
    files: staticFiles.filter(file => file.path === 'offline.html').map(file => ({
      url: `/vela/${file.path}`, sha256: file.sha256,
    })),
    staticFiles: staticFiles.filter(file => file.path.startsWith('_expo/static/')
      || file.path.startsWith('assets/') || file.path.startsWith(`player/${playerAssets.digest}/`)
      || file.path.startsWith('skins/') && file.path !== 'skins/catalog.json').map(file => ({
      url: `/vela/${file.path}`, sha256: file.sha256,
    })),
  };
  const worker = (await readFile(join(source, 'tools/release/sw.js'), 'utf8'))
    .replace('const shell = __VELA_SHELL__;', `const shell = ${JSON.stringify(shell)};`);
  await writeFile(join(dist, 'sw.js'), worker);
  const files = await inventory(dist);
  const archivePath = join(work, archiveName);
  await run(['tar', '--format=ustar', '-czf', archivePath, '-C', dist, '.'], source, env);
  const archive = await readFile(archivePath);
  const manifest = {
    schemaVersion: 1, version, protocolVersions: [0], skinRenderer,
    buildTime: new Date().toISOString(), sourceRevision: revision, sourceDirty: false,
    apiOrigin: 'same-origin', basePath: '/vela/', playerAssetsDigest: playerAssets.digest, playerAssets,
    toolchain: { bun: Bun.version, lockfileSha256: sha256(await readFile(join(source, 'bun.lock'))),
      expo: JSON.parse(await readFile(join(source, 'node_modules/expo/package.json'), 'utf8')).version },
    serviceWorker: { path: '/vela/sw.js', scope: '/vela', headers: {
      'Service-Worker-Allowed': '/vela', 'Cache-Control': 'no-cache',
    } },
    archive: { file: archiveName, bytes: archive.length, sha256: sha256(archive) }, files,
  };
  const json = JSON.stringify(manifest, null, 2) + '\n';
  await rename(archivePath, join(output, archiveName));
  await writeFile(join(output, manifestName), json, { flag: 'wx' });
  await writeFile(join(output, `${archiveName}.sha256`), `${sha256(archive)}  ${archiveName}\n`, { flag: 'wx' });
  await writeFile(join(output, `${manifestName}.sha256`), `${sha256(json)}  ${manifestName}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ archive: join(output, archiveName), manifest: join(output, manifestName),
    sourceRevision: revision, playerAssetsDigest: playerAssets.digest }, null, 2));
} finally {
  await rm(work, { recursive: true, force: true });
}
