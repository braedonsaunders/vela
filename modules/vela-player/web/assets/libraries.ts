// The prepared static libraries: decoder packages, subtitle renderer and font, Dolby Vision parser,
// audio output stage and range-extension vectors, with their licences and corresponding sources.
// They are compiled elsewhere (WASM toolchains); this step verifies every file that has a pin and
// copies the set. The four worker bundles are never taken from the input: workers.ts builds them.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import decoderPins from 'webgpu-player/tools/pinned-releases.json';
import { audioPackages } from '../../../../client/player/universal/audio/packages';
import subtitleManifest from '../../../../client/player/universal/subtitles/assets.json';
import { hashFile, listFiles } from './inventory';
import { WORKER_DIRECTORY } from './workers';

/** Pinned file hashes by payload path under libraries/. */
function pins(): Map<string, string> {
  const pinned = new Map<string, string>();
  for (const entry of Object.values(audioPackages)) pinned.set(`audio-decoders/${entry.file}`, entry.sha256);
  for (const [file, sha256] of Object.entries(decoderPins.decoders.files)) {
    if (!file.endsWith('.wasm') || ['dts.wasm', 'eac3.wasm', 'truehd.wasm', 'wma.wasm'].includes(file)) continue;
    pinned.set(`video-decoders/${file}`, sha256);
  }
  for (const [file, fact] of Object.entries(subtitleManifest.files)) pinned.set(`subtitles/${file}`, fact.sha256);
  return pinned;
}

export interface CopiedLibraries {
  /** Paths under libraries/ whose bytes matched a Vela pin. */
  verified: Set<string>;
  /** Paths under libraries/ with no Vela pin: prebuilt input, recorded by hash in the manifest. */
  prebuilt: string[];
}

export async function copyLibraries(input: string, libraries: string): Promise<CopiedLibraries> {
  const pinned = pins();
  const verified = new Set<string>();
  const prebuilt: string[] = [];
  for (const path of await listFiles(input)) {
    if (path.startsWith(`${WORKER_DIRECTORY}/`) && path.endsWith('.worker.js')) continue;
    const source = join(input, path);
    const expected = pinned.get(path);
    if (expected) {
      if ((await hashFile(source)) !== expected) throw new Error(`Pinned library differs: ${path}`);
      verified.add(path);
    } else {
      prebuilt.push(path);
    }
    await mkdir(dirname(join(libraries, path)), { recursive: true });
    await copyFile(source, join(libraries, path));
  }
  return { verified, prebuilt };
}

const videoFamilies: Record<string, string[]> = {
  hevc: ['hevc'],
  av1: ['av1'],
  mpeg2: ['mpeg1video', 'mpeg2video'],
  mpeg4: ['mpeg4', 'h263', 'msmpeg4v1', 'msmpeg4v2', 'msmpeg4v3'],
  vc1: ['vc1', 'wmv3'],
  jpeg2000: ['jpeg2000'],
};

/** capabilities.json: what the payload installed. Browsers still admit each source themselves. */
export function payloadCapabilities({ verified }: CopiedLibraries) {
  const completeAudio = Object.values(audioPackages).every((entry) =>
    verified.has(`audio-decoders/${entry.file}`),
  );
  const installedVideo = Object.entries(videoFamilies)
    .filter(([id]) => verified.has(`video-decoders/${id}.wasm`))
    .flatMap(([, codecs]) => codecs);
  const completeSubtitles = Object.keys(subtitleManifest.files).every((file) => verified.has(`subtitles/${file}`));
  const originalPlayback =
    completeAudio && installedVideo.includes('hevc')
      ? {
          version: 1,
          range: true,
          webgpu: true,
          demuxContainers: ['mkv', 'mp4', 'mov', 'webm'],
          videoDecoders: [...new Set(['h264', 'hevc', 'vp9', 'av1', ...installedVideo])],
          audioDecoders: [
            'aac', 'ac3', 'eac3', 'truehd', 'dts', 'flac', 'opus', 'vorbis', 'mp3', 'alac', 'mp1', 'mp2',
            'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_f64le',
          ],
        }
      : undefined;
  return {
    schemaVersion: 1,
    ...(originalPlayback ? { originalPlayback } : {}),
    embeddedSubtitleFormats: completeSubtitles ? ['srt', 'webvtt', 'ass', 'ssa', 'pgs', 'tx3g'] : [],
  };
}
