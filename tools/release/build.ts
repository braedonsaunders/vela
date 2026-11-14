/** Local-only release packager. No publishing and no changes to vendor/exact. */
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const releases = join(homedir(), '.scratch/tmp/vela/release');
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
const sourceDirty = !!(await run(['git', 'status', '--porcelain', '--', 'client', 'protocol', 'tools/release', 'EXACT_REVISION'])).trim();
await mkdir(releases, { recursive: true });
const archiveName = `vela-${version}.tar.gz`, manifestName = `vela-${version}.manifest.json`;
for (const name of [archiveName, manifestName, `${archiveName}.sha256`, `${manifestName}.sha256`]) {
  if (await Bun.file(join(releases, name)).exists()) throw new Error(`${name} already exists; versions are immutable. Move prior local output aside or increment the version.`);
}
const work = await mkdtemp(join(releases, '.build-'));
try {
  // Copy only repository inputs, including current edits, so the build never rewrites shared source files.
  const files = (await run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'client', 'protocol'])).split('\0').filter(Boolean);
  for (const path of files) {
    const from = join(root, path), to = join(work, path);
    await mkdir(dirname(to), { recursive: true });
    if ((await lstat(from)).isSymbolicLink()) await symlink(await readlink(from), to);
    else await copyFile(from, to);
  }
  const client = join(work, 'client');
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
  // --out selects Exact's production target (minified, no agent overlay).
  console.log(await run([process.execPath, 'player/build.ts'], client, env));
  const dist = join(client, 'dist');
  console.log(await run([process.execPath, 'exact.mjs', 'web-build', '--out', dist, '--render', 'none'], client, env));
  // Exact's generated shell defaults to /. Change only our staged output.
  for (const name of ['index.html', 'shell.html']) {
    const path = join(dist, name);
    if (!await Bun.file(path).exists()) continue;
    const html = await readFile(path, 'utf8');
    if (!html.includes('<base href="/">')) throw new Error(`Unexpected base tag in ${name}`);
    await writeFile(path, html.replace('<base href="/">', '<base href="/vela/">'));
  }
  const pwaPath = join(dist, 'manifest.json');
  const pwa = JSON.parse(await readFile(pwaPath, 'utf8'));
  pwa.start_url = '/vela'; pwa.scope = '/vela';
  await writeFile(pwaPath, JSON.stringify(pwa, null, 2) + '\n');
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
  const manifest = { schemaVersion: 1, version, protocolVersions: [0], exactRevision, buildTime: new Date().toISOString(), sourceRevision, sourceDirty, apiOrigin: 'same-origin', basePath: '/vela/', archive: { file: archiveName, bytes: archiveBytes.length, sha256: archiveSha256 }, files: cards };
  const manifestBytes = JSON.stringify(manifest, null, 2) + '\n';
  await copyFile(archive, join(releases, archiveName));
  await writeFile(join(releases, manifestName), manifestBytes);
  await writeFile(join(releases, `${archiveName}.sha256`), `${archiveSha256}  ${archiveName}\n`);
  await writeFile(join(releases, `${manifestName}.sha256`), `${digest(manifestBytes)}  ${manifestName}\n`);
  console.log(JSON.stringify({ archive: join(releases, archiveName), sha256: archiveSha256, manifest: join(releases, manifestName), manifestSha256: digest(manifestBytes), sourceDirty }, null, 2));
} finally {
  await rm(work, { recursive: true, force: true });
}
