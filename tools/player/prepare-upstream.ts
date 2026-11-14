/** Assemble the real upstream runtime; this is an asset build, not a check lane. */
import { cp, mkdir, readFile, copyFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { transformUpstreamAudio } from '../../client/player/universal/audio/ffmpeg/upstream-transform';
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
// Vela's codec-private/layout hooks are explicit build-time adaptations. The
// pinned checkout stays pristine; corresponding Vela hook source ships too.
const { build } = await import(pathToFileURL(join(upstream, 'node_modules/esbuild/lib/main.js')).href);
const plugin = { name:'vela-audio', setup(builder: any) {
  builder.onLoad({filter:/\.ts$/}, async ({path}: {path:string}) => {
    const transformed = transformUpstreamAudio(path, await readFile(path, 'utf8'));
    if (transformed !== null) return {contents:transformed, loader:'ts', resolveDir:dirname(path)};
  });
}};
const common = {bundle:true, platform:'browser', target:'es2022', absWorkingDir:upstream,
  alias:{mediabunny:join(bunny, 'src/index.ts')}, plugins:[plugin]};
const { getWorkerEntryPoints } = await import(pathToFileURL(join(upstream, 'scripts/library-assets.mjs')).href);
for (const [target, entry] of getWorkerEntryPoints()) {
  await build({...common, entryPoints:[entry], format:'iife', outfile:join(libraries,target)});
}
await build({...common, entryPoints:[join(root,'client/player/universal/runtime.ts')], format:'esm', outfile:join(destination,'runtime.js')});
await cp(join(root,'client/player/universal/audio/ffmpeg'), join(sourceDir,'vela-audio-hooks'), {recursive:true});
const audioDirectory = Bun.argv.find(arg => arg.startsWith('--audio-dir='))?.slice(12);
if (audioDirectory) await run([process.execPath, join(root,'client/player/universal/audio/install-packages.ts'), join(libraries,'audio-decoders'), `--from=${resolve(audioDirectory)}`], root);
const videoDirectory = Bun.argv.find(arg => arg.startsWith('--video-dir='))?.slice(12);
if (videoDirectory) await run([process.execPath, join(root,'client/player/universal/video/install-packages.ts'), join(libraries,'video-decoders'), `--from=${resolve(videoDirectory)}`], root);
const hash = createHash('sha256');
async function hashFiles(directory: string) {
  for (const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const file=join(directory,entry.name);
    if (entry.isDirectory()) await hashFiles(file);
    else if (entry.isFile()) { hash.update(file.slice(destination.length)); hash.update(await readFile(file)); }
  }
}
await hashFiles(libraries); hash.update(await readFile(join(destination,'runtime.js')));
const assetKey = hash.digest('hex').slice(0,16);
await Bun.write(join(destination, 'assets.json'), JSON.stringify({ version:1, upstreamRevision:revision, assetKey, libraries:'./libraries/', sources:'./sources/' },null,2)+'\n');
console.log(`Universal runtime assets assembled at ${destination}, key ${assetKey}`);
