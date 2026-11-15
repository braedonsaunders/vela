/** Assemble the real upstream runtime; this is an asset build, not a check lane. */
import { cp, mkdir, readFile, copyFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { audioPackages } from '../../client/player/universal/audio/packages';
import decoderPins from '../../vendor/webgpu-player/tools/pinned-releases.json';
import { stageUniversalAssets } from '../release/universal-assets';
import { transformUpstreamAudio } from '../../client/player/universal/audio/ffmpeg/upstream-transform';
import {transformUpstreamTransport} from '../../client/player/universal/transport-transform';
import {transformCoreDemux} from '../../client/player/core/demux/transform';
import {transformCoreAudio} from '../../client/player/core/audio/transform';
import { transformUpstreamVideo } from '../../client/player/universal/video/upstream-transform';
import { installSubtitleAssets } from '../../client/player/universal/subtitles/install';
import subtitleManifest from '../../client/player/universal/subtitles/assets.json';
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
const destination = resolve(Bun.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? join(root, 'client/modules/web/universal'));
const libraries = join(destination, 'libraries');
const reuse = Bun.argv.find(arg => arg.startsWith('--reuse-assets='))?.slice(15);
let preparedLibraries: string | undefined;
if (reuse) {
  // Explicit immutable input restores already built WASM without depending on
  // the compiler cache. All input hashes/key/source notices are revalidated.
  const staging = join(root,'client/.exact/universal-verified-input');
  const identity = await stageUniversalAssets(resolve(reuse),staging);
  preparedLibraries = join(staging,'universal',identity.assetKey,'libraries');
} else {
  await run(['make', '-C', 'wasm', 'all']);
  await run(['node', 'scripts/build.mjs', '--production']);
}
await mkdir(libraries, { recursive: true });
await cp(preparedLibraries ?? join(upstream, 'bin/libraries'), libraries, { recursive: true });
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
    const original = await readFile(path, 'utf8');
    const audio = transformUpstreamAudio(path, original);
    const video = transformUpstreamVideo(path, audio ?? original);
    const transport=transformUpstreamTransport(path,video??audio??original);
    const clock=Bun.argv.includes('--core')?transformCoreDemux(path,transport??video??audio??original):null;
    const coreAudio=Bun.argv.includes('--core')?transformCoreAudio(path,clock??transport??video??audio??original):null;
    const transformed = coreAudio??clock??transport??video??audio;
    if (transformed !== null) return {contents:transformed, loader:'ts', resolveDir:dirname(path)};
  });
}};
const common = {bundle:true, platform:'browser', target:'es2022', absWorkingDir:upstream,
  alias:{mediabunny:join(bunny, 'src/index.ts')}, plugins:[plugin]};
const { getWorkerEntryPoints } = await import(pathToFileURL(join(upstream, 'scripts/library-assets.mjs')).href);
for (const [target, entry] of getWorkerEntryPoints()) {
  await build({...common, entryPoints:[entry], format:'iife', outfile:join(libraries,target)});
}
// Explicit local migration candidate. Production stays on the qualified entry
// until the Vela-owned core passes its direct H.264/HEVC parity gate.
const runtimeEntry=Bun.argv.includes('--core')?'client/player/core/adapter.ts':'client/player/universal/runtime.ts';
await build({...common, entryPoints:[join(root,runtimeEntry)], format:'esm', outfile:join(destination,'runtime.js')});
await cp(join(root,'client/player/universal/audio/ffmpeg'), join(sourceDir,'vela-audio-hooks'), {recursive:true});
await copyFile(join(root,'client/player/universal/transport-transform.ts'),join(sourceDir,'vela-transport-transform.ts'));
await copyFile(join(root,'client/player/universal/transport.ts'),join(sourceDir,'vela-transport.ts'));
await copyFile(join(root,'client/player/media-auth.ts'),join(sourceDir,'vela-media-auth.ts'));
await copyFile(join(root,'client/player/universal/video/upstream-transform.ts'), join(sourceDir,'vela-video-transform.ts'));
if(Bun.argv.includes('--core')){
  await mkdir(join(sourceDir,'vela-core-demux'),{recursive:true});
  await copyFile(join(root,'client/player/core/audio/transform.ts'),join(sourceDir,'vela-core-audio-transform.ts'));
  for(const file of ['fragment-time.ts','subtitle-stream.ts','transform.ts'])await copyFile(join(root,'client/player/core/demux',file),join(sourceDir,'vela-core-demux',file));
}
const audioDirectory = Bun.argv.find(arg => arg.startsWith('--audio-dir='))?.slice(12);
if (audioDirectory) await run([process.execPath, join(root,'client/player/universal/audio/install-packages.ts'), join(libraries,'audio-decoders'), `--from=${resolve(audioDirectory)}`], root);
const videoDirectory = Bun.argv.find(arg => arg.startsWith('--video-dir='))?.slice(12);
if (videoDirectory) await run([process.execPath, join(root,'client/player/universal/video/install-packages.ts'), join(libraries,'video-decoders'), `--from=${resolve(videoDirectory)}`], root);
const subtitleDirectory=Bun.argv.find(arg=>arg.startsWith('--subtitle-dir='))?.slice(15);
if(subtitleDirectory)await installSubtitleAssets(join(libraries,'subtitles'),resolve(subtitleDirectory));
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
// Publish a route declaration only from this complete, verified asset set. It
// names installed decoder families; per-source exact eligibility is still local.
async function verified(directory: string, file: string, expected: string) {
  const input = Bun.file(join(libraries,directory,file));
  return await input.exists() && createHash('sha256').update(new Uint8Array(await input.arrayBuffer())).digest('hex') === expected;
}
const completeAudio = (await Promise.all(Object.values(audioPackages).map(entry => verified('audio-decoders',entry.file,entry.sha256)))).every(Boolean);
const videoFamilies = {hevc:['hevc'],av1:['av1'],mpeg2:['mpeg1video','mpeg2video'],mpeg4:['mpeg4','h263','msmpeg4v1','msmpeg4v2','msmpeg4v3'],vc1:['vc1','wmv3'],jpeg2000:['jpeg2000']} as const;
const installedVideo: string[] = [];
for (const [id,codecs] of Object.entries(videoFamilies)) {
  const file = `${id}.wasm` as keyof typeof decoderPins.decoders.files;
  if (await verified('video-decoders',file,decoderPins.decoders.files[file])) installedVideo.push(...codecs);
}
const originalPlayback = completeAudio && installedVideo.includes('hevc') ? {
  version:1,range:true,webgpu:true,demuxContainers:['mkv','mp4','mov','webm'],
  videoDecoders:[...new Set(['h264','hevc','vp9','av1',...installedVideo])],
  audioDecoders:['aac','ac3','eac3','truehd','dts','flac','opus','vorbis','mp3','alac','mp1','mp2','pcm_s16le','pcm_s24le','pcm_s32le','pcm_f32le','pcm_f64le'],
} : undefined;
const completeSubtitles=(await Promise.all(Object.entries(subtitleManifest.files).map(([file,fact])=>verified('subtitles',file,fact.sha256)))).every(Boolean);
const subtitleAssets=completeSubtitles?{assetKey:subtitleManifest.assetKey,directory:'libraries/subtitles/'}:undefined;
const core=Bun.argv.includes('--core')?{version:1,vodHls:true,liveHls:true}:undefined;
const originalSubtitleFormats=completeSubtitles&&Bun.argv.includes('--core')?['srt','webvtt','ass','ssa','pgs','tx3g']:undefined;
await Bun.write(join(destination, 'assets.json'), JSON.stringify({ version:1, upstreamRevision:revision, assetKey, libraries:'./libraries/', sources:'./sources/', originalPlayback,subtitleAssets,originalSubtitleFormats,core },null,2)+'\n');
console.log(`Universal runtime assets assembled at ${destination}, key ${assetKey}`);
