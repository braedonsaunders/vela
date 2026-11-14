/** Assemble the real upstream runtime; this is an asset build, not a check lane. */
import { cp, mkdir, readFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dir, '../..');
const upstream = join(root, 'vendor/webgpu-player');
const revision = 'a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2';
async function run(args: string[], cwd = upstream) {
  const child = Bun.spawn(args, { cwd, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) throw new Error(`Player asset build failed: ${args[0]}`);
}
const actual = await new Response(Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: upstream, stdout: 'pipe', stderr: 'inherit' }).stdout).text();
if (actual.trim() !== revision) throw new Error('Universal player source revision differs from the reviewed pin');
if (Bun.argv.includes('--bootstrap')) {
  await run(['git', 'submodule', 'update', '--init', '--depth', '1', 'vendor/mediabunny']);
  await run(['npm', 'ci', '--no-audit', '--no-fund']);
  await run(['make', '-C', 'wasm', 'emsdk']);
}
await run(['make', '-C', 'wasm', 'all']);
await run(['node', 'scripts/build.mjs', '--production']);
const destination = resolve(Bun.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? join(root, 'client/modules/web/universal'));
const libraries = join(destination, 'libraries');
await mkdir(libraries, { recursive: true });
await cp(join(upstream, 'bin/libraries'), libraries, { recursive: true });
await copyFile(join(root, 'THIRD_PARTY_NOTICES'), join(destination, 'THIRD_PARTY_NOTICES'));
// Workers contain the MPL fork: retain its exact corresponding source and licence.
const sourceDir = join(destination, 'sources');
await mkdir(sourceDir, { recursive: true });
const bunny = join(upstream, 'vendor/mediabunny');
await run(['git', 'archive', '--format=tar.gz', '--prefix=mediabunny/', `--output=${join(sourceDir, 'mediabunny.tar.gz')}`, 'HEAD'], bunny);
await copyFile(join(bunny, 'LICENSE'), join(sourceDir, 'Mediabunny-LICENSE'));
const build = JSON.parse(await readFile(join(upstream, 'bin/build-info.json'), 'utf8')) as { assetKey: string };
await Bun.write(join(destination, 'assets.json'), JSON.stringify({ version: 1, upstreamRevision: revision, assetKey: build.assetKey, libraries: './libraries/', sources: './sources/' }, null, 2) + '\n');
console.log(`Universal runtime assets assembled at ${destination}`);
