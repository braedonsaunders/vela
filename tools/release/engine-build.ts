/** Local-only release packager. No publishing and no changes to vendor/exact. */
import { prepareEngine } from '../engine';
import { generateLocales } from '../locales';
import { writePwaAssets, pwaIcons } from './pwa-assets';
import { externalizeAssets } from './assets';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dir, '../..');
const committed = process.argv.includes('--committed');
if (process.argv.some(arg => arg.startsWith('--universal-assets'))) throw new Error('Use release/build.ts for shared universal assets');
const mapReport = process.argv.includes('--map-report');
const engine = process.argv[process.argv.indexOf('--engine') + 1];
if (!process.argv.includes('--engine') || !/^[a-z][a-z0-9-]*$/.test(engine)) throw new Error('Use build.ts to produce the multi-engine release');
const releases = join(root, '.artifacts/release');
const pkg = await Bun.file(join(root, 'client/package.json')).json();
const version = String(pkg.version ?? (await readFile(join(import.meta.dir, 'VERSION'), 'utf8')).trim());
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Release version must be a semantic version');
const exactRevision = (await readFile(join(root, 'EXACT_REVISION'), 'utf8')).trim();
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
async function run(cmd: string[], cwd = root, env: Record<string, string | undefined> = process.env): Promise<string> {
  const child = Bun.spawn(cmd, { cwd, env, stdout: 'pipe', stderr: 'inherit' });
  const output = new Response(child.stdout).text();
  const code = await child.exited;
  const text = await output;
  if (code) throw new Error(`${cmd[0]} ${cmd[1] ?? ''} exited ${code}`);
  return text;
}
const actualExact = (await run(['git', '-C', join(root, 'vendor/exact'), 'rev-parse', 'HEAD'])).trim();
if (actualExact !== exactRevision) throw new Error(`Exact checkout is ${actualExact}, expected ${exactRevision}`);
const sourceRevision = (await run(['git', 'rev-parse', 'HEAD'])).trim();
const toolDirty = !!(await run(['git', 'status', '--porcelain', '--', 'tools/release', 'tools/engine.ts', 'tools/skin-registry.ts', 'tools/locales.ts', 'EXACT_REVISION'])).trim();
if (committed && toolDirty) throw new Error('Commit release tooling before building a committed snapshot');
const sourceDirty = committed ? false : !!(await run(['git', 'status', '--porcelain', '--', 'client', 'protocol', 'tools/release', 'tools/engine.ts', 'tools/skin-registry.ts', 'tools/locales.ts', 'EXACT_REVISION'])).trim();
await mkdir(releases, { recursive: true });
const archiveName = `vela-${version}-${engine}.tar.gz`, manifestName = `vela-${version}-${engine}.manifest.json`;
for (const name of [archiveName, manifestName, `${archiveName}.sha256`, `${manifestName}.sha256`]) {
  if (await Bun.file(join(releases, name)).exists()) throw new Error(`${name} already exists; versions are immutable. Move prior local output aside or increment the version.`);
}
const work = await mkdtemp(join(releases, '.build-'));
try {
  if (committed) {
    const tar = join(work, 'source.tar');
    const archive = Bun.spawn(['git', 'archive', '--format=tar', sourceRevision, 'client', 'protocol'], { cwd: root, stdout: Bun.file(tar), stderr: 'inherit' });
    if (await archive.exited) throw new Error('Could not archive committed source');
    await run(['tar', '-xf', tar, '-C', work]);
    await rm(tar);
  } else {
  // Copy repository inputs without rewriting shared source files.
  const files = (await run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'client', 'protocol'])).split('\0').filter(Boolean);
  for (const path of files) {
    const from = join(root, path), to = join(work, path);
    await mkdir(dirname(to), { recursive: true });
    if ((await lstat(from)).isSymbolicLink()) await symlink(await readlink(from), to);
    else await copyFile(from, to);
  }
  }
  const client = join(work, 'client');
  await prepareEngine(client, engine);
  await generateLocales(client);
  const manifestPath = join(client, 'app.json');
  const app = JSON.parse(await readFile(manifestPath, 'utf8'));
  app.start_url = '/vela';
  await writeFile(manifestPath, JSON.stringify(app, null, 2) + '\n');
  const contractPath = join(client, 'app.contract');
  const contract = await readFile(contractPath, 'utf8');
  let routeCount = 0;
  const routed = contract.replace(/^(\s+\w+ )"(\/[^"\n]*)"\s*$/gm, (line, prefix, path) => {
    // Route declarations are the only bare indented identifier + quoted path lines.
    routeCount++; return `${prefix}"${path === "/" ? "/vela" : "/vela" + path}"`;
  });
  if (!routeCount) throw new Error('No route declarations found to mount under /vela/');
  // Exact permits a non-root first route only with an explicit unmatched-location fallback.
  const mounted = routed.replace(/^(routes \w+\n)([\s\S]*?)(?=^\S)/m, (block, header, declarations) =>
    /^  notfound(?:\s|$)/m.test(declarations) ? block : `${header}${declarations.trimEnd()}\n  notfound\n\n`);
  await writeFile(contractPath, mounted);
  const env = { ...process.env, EXACT: join(root, 'vendor/exact'), EXACT2: join(root, 'vendor/exact'), API_BASE_URL: '', VELA_MOCK: '0', VELA_BUILD_VERSION: version, EXACT_VERSION: version };
  let planNodes: { total: number; bySource: Record<string, number>; byComponent: Record<string, number> } | undefined;
  if (mapReport) {
    const plan = join(work, 'app.plan');
    console.log(await run([process.execPath, 'exact.mjs', 'contract', 'build', 'app.contract', '--map', '-o', plan], client, env));
    const map = JSON.parse(await readFile(`${plan}.map.json`, 'utf8'));
    planNodes = { total: map.nodes.length, bySource: {}, byComponent: {} };
    for (const node of map.nodes) {
      const file = String(node.file).replaceAll('\\', '/');
      const source = file.includes('/skins/') ? file.split('/skins/')[1].split('/')[0] : file.includes('/foundation/') ? 'foundation' : file.split('/').pop()!;
      planNodes.bySource[source] = (planNodes.bySource[source] ?? 0) + 1;
      const component = `${source}/${file.split('/').pop()}#${node.component}`;
      planNodes.byComponent[component] = (planNodes.byComponent[component] ?? 0) + 1;
    }
  }
  // --out selects Exact's production target (minified, no agent overlay).
  console.log(await run([process.execPath, 'player/build.ts'], client, env));
  const dist = join(client, 'dist');
  console.log(await run([process.execPath, 'exact.mjs', 'web-build', '--out', dist, '--render', 'none'], client, env));
  await writePwaAssets(dist);
  await copyFile(join(import.meta.dir, 'pwa.js'), join(dist, 'pwa.js'));
  await writeFile(join(dist, 'offline.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#090B0E"><title>Vela · Offline</title><style>body{margin:0;min-height:100vh;display:grid;place-content:center;gap:1rem;padding:2rem;box-sizing:border-box;background:#090B0E;color:#f2e9d6;font:18px system-ui}h1,p{margin:0}a{color:inherit}</style><h1>You’re offline</h1><p>Reconnect to browse and play from your server.</p><a href="/vela">Try again</a></html>');
  const pwaPath = join(dist, 'manifest.json');
  const pwa = JSON.parse(await readFile(pwaPath, 'utf8'));
  Object.assign(pwa, { id: '/vela', name: 'Vela', short_name: 'Vela', start_url: '/vela', scope: '/vela', display: 'standalone', theme_color: '#090B0E', background_color: '#090B0E', icons: pwaIcons });
  await writeFile(pwaPath, JSON.stringify(pwa, null, 2) + '\n');
  console.log(JSON.stringify({ assets: await externalizeAssets(dist) }));
  const cacheFiles = new Map<string, { url: string; sha256: string }>();
  async function immutableUrl(name: string): Promise<string> {
    const sha256 = digest(await readFile(join(dist, name))), url = `/vela/${name}?v=${sha256}`;
    cacheFiles.set(url, { url, sha256 }); return url;
  }
  const installUrl = await immutableUrl('pwa.js');
  // Keep Exact's ESM URLs canonical. Its chunks can import back into app.js;
  // query-qualifying only the HTML entry would evaluate that module twice.
  for (const name of ['index.html', 'shell.html']) {
    const path = join(dist, name);
    if (!await Bun.file(path).exists()) continue;
    let html = await readFile(path, 'utf8');
    if (!html.includes('<base href="/">')) throw new Error(`Unexpected base tag in ${name}`);
    html = html.replace('<base href="/">', `<base href="/vela/"><meta name="theme-color" content="#090B0E"><link rel="apple-touch-icon" href="/vela/vela-icon-180.png"><script type="module" src="${installUrl}"></script>`);
    html = html.replace(/<link rel="icon"[^>]*>/, '<link rel="icon" type="image/svg+xml" href="/vela/vela-icon.svg">');
    await writeFile(path, html);
  }
  // Cache content-addressed chunks and our standalone PWA/offline resources only.
  // Exact's unversioned app.js, styles and native modules remain network-only.
  for (const name of await readdir(dist)) if (/-[A-Za-z0-9_-]{8,}\.(?:js|css|wasm)$/.test(name)) {
    const url = `/vela/${name}`; cacheFiles.set(url, { url, sha256: digest(await readFile(join(dist, name))) });
  }
  const offlineUrl = await immutableUrl('offline.html');
  const filesToCache = [...cacheFiles.values()];
  const shell = { version, digest: digest(JSON.stringify(filesToCache)).slice(0,16), offlineUrl, files: filesToCache };
  const worker = (await readFile(join(import.meta.dir, 'sw.js'), 'utf8')).replace('const shell = __VELA_SHELL__;', `const shell = ${JSON.stringify(shell)};`);
  await writeFile(join(dist, 'sw.js'), worker);
  // Build metadata is host-local and is not an installer/runtime input.
  await rm(join(dist, '.exact-build.json'), { force: true });
  const cards: { path: string; bytes: number; sha256: string }[] = [];
  async function inventory(dir: string) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await inventory(path);
      else if (entry.isFile()) { const bytes = await readFile(path); cards.push({ path: relative(dist, path).split('\\').join('/'), bytes: bytes.length, sha256: digest(bytes) }); }
      else throw new Error(`Static output contains unsupported link/device: ${path}`);
    }
  }
  await inventory(dist);
  if (!cards.some(c => c.path === 'index.html')) throw new Error('Build has no index.html');
  const archive = join(work, archiveName);
  await run(['tar', '--format=ustar', '-czf', archive, '-C', dist, '.'], root, { ...process.env, COPYFILE_DISABLE: '1' });
  const archiveBytes = await readFile(archive), archiveSha256 = digest(archiveBytes);
  const manifest = { schemaVersion: 1, version, protocolVersions: [0], exactRevision, buildTime: new Date().toISOString(), sourceRevision, sourceDirty, apiOrigin: 'same-origin', basePath: '/vela/', serviceWorker: { path: '/vela/sw.js', scope: '/vela', headers: { 'Service-Worker-Allowed': '/vela', 'Cache-Control': 'no-cache' } }, archive: { file: archiveName, bytes: archiveBytes.length, sha256: archiveSha256 }, files: cards };
  const manifestBytes = JSON.stringify(manifest, null, 2) + '\n';
  await copyFile(archive, join(releases, archiveName));
  await writeFile(join(releases, manifestName), manifestBytes);
  await writeFile(join(releases, `${archiveName}.sha256`), `${archiveSha256}  ${archiveName}\n`);
  await writeFile(join(releases, `${manifestName}.sha256`), `${digest(manifestBytes)}  ${manifestName}\n`);
  if (mapReport) {
    const entry = await readFile(join(dist, 'app.js'));
    const report = { version, sourceRevision, sourceDirty, appBytes: entry.length, appGzip9Bytes: gzipSync(entry, { level: 9 }).length, planNodes };
    await writeFile(join(releases, `vela-${version}-${engine}.bundle.json`), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ bundleReport: report }));
  }
  console.log(JSON.stringify({ archive: join(releases, archiveName), sha256: archiveSha256, manifest: join(releases, manifestName), manifestSha256: digest(manifestBytes), sourceDirty }, null, 2));
} finally {
  await rm(work, { recursive: true, force: true });
}
