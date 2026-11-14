// EMSDK=/scratch/pinned-emsdk bun client/player/universal/audio/ffmpeg/build.ts <distribution-dir>
import { mkdir, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import codecs from './codecs.json';
const commit = 'a59498db085e3d635532397128550141ab87408a';
const sourceHash = 'fabdcecd57f9a7864fe1afedc3ab835d0fe4ee0f0473b8543533b497ecae8f8f';
const sdk = process.env.EMSDK;
if (!sdk) throw new Error('Set EMSDK to the existing pinned Emscripten4.0.13 SDK; this build does not install another SDK');
const em = join(sdk, 'upstream/emscripten');
const llvm = join(sdk, 'upstream/bin');
const output = process.argv[2] && resolve(process.argv[2]);
if (!output) throw new Error('Supply the separately served audio-decoder distribution directory');
const scratch = join(homedir(), '.scratch/tmp/vela/audio-general-build');
const source = join(scratch, `ffmpeg-${commit}`);
const bridge = import.meta.dir;
const env = { ...process.env, EMSDK: sdk, EM_CONFIG: join(sdk, '.emscripten'), SOURCE_DATE_EPOCH: '0', ZERO_AR_DATE: '1', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
async function run(args: string[], cwd = scratch) {
  const child = Bun.spawn(args, { cwd, env, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited) throw new Error(`${args[0]} failed`);
}
await mkdir(scratch, { recursive: true }); await mkdir(output, { recursive: true });
const version = Bun.spawn([join(em, 'emcc'), '--version'], { env, stdout: 'pipe' });
const versionText = await new Response(version.stdout).text();
if (await version.exited || !versionText.includes('4.0.13 (2659582941bef14008476903f48941909db1b196)')) throw new Error('Pinned Emscripten4.0.13 revision required');
const archive = join(scratch, `ffmpeg-${commit}.tar.gz`);
if (!await Bun.file(archive).exists()) {
  const response = await fetch(`https://github.com/alchemyyy/webgpu-player-decoders/releases/download/v0.1.1/ffmpeg-${commit}.tar.gz`);
  if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
  await Bun.write(archive, response);
}
if (new Bun.CryptoHasher('sha256').update(await Bun.file(archive).arrayBuffer()).digest('hex') !== sourceHash) throw new Error('FFmpeg source integrity mismatch');
if (!await Bun.file(join(source, 'configure')).exists()) await run(['tar', '-xzf', archive, '-C', scratch]);
const configuration = [
  '--target-os=none', '--arch=x86_32', '--enable-cross-compile', '--disable-asm', '--disable-x86asm', '--disable-inline-asm',
  '--disable-programs', '--disable-doc', '--disable-debug', '--disable-all', '--disable-everything', '--disable-autodetect',
  '--disable-pthreads', '--disable-runtime-cpudetect', '--disable-gpl', '--disable-iconv', '--disable-version3', '--disable-nonfree', '--enable-avcodec', '--enable-swresample',
  ...codecs.map(([, decoder]) => `--enable-decoder=${decoder}`),
  `--cc=${join(em, 'emcc')}`, `--cxx=${join(em, 'em++')}`, `--ar=${join(em, 'emar')}`,
  `--ranlib=${join(em, 'emranlib')}`, `--nm=${join(llvm, 'llvm-nm')}`, '--host-cc=cc',
  `--extra-cflags=-DNDEBUG -O3 -flto -msimd128 -ffile-prefix-map=${source}=ffmpeg-source`, '--extra-ldflags=-O3 -flto',
];
// Reuse the coherent scratch build; configure only when enabled codecs/flags change.
const key = JSON.stringify(configuration);
if (!await Bun.file(join(scratch, 'configuration.json')).exists() || await Bun.file(join(scratch, 'configuration.json')).text() !== key) {
  await run(['./configure', ...configuration], source);
  await Bun.write(join(scratch, 'configuration.json'), key);
}
const config = await Bun.file(join(source, 'config.h')).text();
for (const required of ['CONFIG_GPL 0', 'CONFIG_VERSION3 0', 'CONFIG_NONFREE 0', 'CONFIG_AVCODEC 1'])
  if (!config.includes('#define ' + required)) throw new Error(`FFmpeg configuration lacks ${required}`);
const components = await Bun.file(join(source, 'config_components.h')).text();
for (const [, decoder] of codecs)
  if (!components.includes(`#define CONFIG_${decoder.toUpperCase()}_DECODER 1`)) throw new Error(`Missing FFmpeg decoder ${decoder}`);
await run(['make', '-j2', 'libavcodec/libavcodec.a', 'libswresample/libswresample.a', 'libavutil/libavutil.a'], source);
await Bun.write(join(scratch, 'codec_ids.h'), `static const enum AVCodecID codec_ids[]={${codecs.map(([, , id]) => 'AV_CODEC_ID_' + id).join(',')}};\n`);
const functions = ['abi_version', 'create', 'destroy', 'reserve_input', 'configure', 'set_option', 'send', 'receive', 'frame_count', 'sample_rate',
  'channel_count', 'channel_mask', 'channel_pointer', 'timestamp', 'attribute', 'clear', 'error_code', 'error_value', 'drain'];
const modulePath = join(scratch, 'module.wasm');
await run([join(em, 'emcc'), join(bridge, 'vela_audio.c'), join(source, 'libavcodec/libavcodec.a'), join(source, 'libswresample/libswresample.a'), join(source, 'libavutil/libavutil.a'),
  '-I' + source, '-I' + scratch, '-O3', '-flto', '-msimd128', '-sSTANDALONE_WASM', '-sIMPORTED_MEMORY', '-sFILESYSTEM=0',
  '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=16777216', '-sMAXIMUM_MEMORY=268435456', '-sMALLOC=emmalloc', '-sASSERTIONS=0', '--no-entry',
  '-sEXPORTED_FUNCTIONS=' + functions.map(f => '_audio_decoder_' + f).join(','),
  `-ffile-prefix-map=${source}=ffmpeg-source`, `-ffile-prefix-map=${bridge}=vela-audio-source`, '-o', modulePath]);
const manifest = `//! id: vela-audio\n//! name: Vela FFmpeg Audio\n//! decoder: audio\n//! accepts: codec in [${codecs.map(([name]) => name).join(', ')}]\n//! packet: 2 MiB\n//! attribute: 1, libraryVersion\n//! option: 1, velaConfiguration\n//! error: 1, input\n//! error: 2, send\n//! error: 3, receive\n//! error: 4, sampleFormat\n//! error: 5, option\n//! error: 6, output\n//! error: 7, open\n`;
// Custom WASM section; keep this builder independent of the engine's dev dependencies.
function leb(n: number) { const bytes: number[] = []; do { let b = n & 127; n = Math.floor(n / 128); bytes.push(b | (n ? 128 : 0)); } while (n); return bytes; }
const sectionName = new TextEncoder().encode('webgpu-player.decoder');
const text = new TextEncoder().encode(manifest);
const content = new Uint8Array([...leb(sectionName.length), ...sectionName, ...text]);
const raw = new Uint8Array(await Bun.file(modulePath).arrayBuffer());
const section = new Uint8Array([0, ...leb(content.length), ...content]);
const bytes = new Uint8Array(raw.length + section.length); bytes.set(raw); bytes.set(section, raw.length);
const { loadDecoderPackage } = await import('../../../../../vendor/webgpu-player/src/decode/packages/DecoderPackage');
const loaded = await loadDecoderPackage(bytes.buffer);
if (loaded.kind !== 'audio' || loaded.id !== 'vela-audio' || loaded.manifest.codecs.length !== codecs.length) throw new Error('Audio package validation failed');
await Bun.write(join(output, 'vela-audio.wasm'), bytes);
const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
await Bun.write(join(output, 'vela-audio.json'), JSON.stringify({ id: 'vela-audio', file: 'vela-audio.wasm', sha256, codecs: codecs.map(([name]) => name), ffmpegCommit: commit }, null, 2));
await copyFile(archive, join(output, `ffmpeg-${commit}.tar.gz`));
await copyFile(join(source, 'COPYING.LGPLv2.1'), join(output, 'FFmpeg-COPYING.LGPLv2.1'));
await run(['tar', '-czf', join(output, 'vela-audio-source.tar.gz'), '-C', bridge, 'vela_audio.c', 'build.ts', 'codecs.json', 'configuration.ts']);
await Bun.write(join(output, 'VELA-AUDIO-SOURCE.txt'), `Vela FFmpeg Audio, LGPL-2.1-or-later. Complete corresponding source is ffmpeg-${commit}.tar.gz and vela-audio-source.tar.gz beside this file. Build with Emscripten4.0.13 using build.ts; GPL, nonfree and version3 code are disabled. Modules may be replaced/relinked, with reverse engineering permitted for debugging modifications. FFmpeg source archive SHA256 ${sourceHash}.\n`);
console.log(`Built ${join(output, 'vela-audio.wasm')} ${sha256} (${bytes.length} bytes, ${codecs.length} codecs)`);
