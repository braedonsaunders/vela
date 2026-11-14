/** Separately replaceable LGPL modules. No codec code is linked into the app bundle. */
export const audioPackages = {
  truehd: { file: 'truehd.wasm', sha256: 'af594a327e706205d3da60050398d34e0cfa0d45c9de809c648c6661df3d8273', codecs: ['truehd', 'mlp'] },
  dts: { file: 'dts.wasm', sha256: 'cc8454c5a6c7672f47c3a4b6ef7e2e4bf412805ab11491687d6f8fbc2bc005db', codecs: ['dts'] },
  eac3: { file: 'eac3.wasm', sha256: 'fac88bb851c8ae7ca58cae0c70f96733882ecc15cf3667e5aee167ce9f2aed8c', codecs: ['eac3', 'ac3'] },
} as const;
export type AudioPackageId = keyof typeof audioPackages;
export const audioPackageRelease = 'https://github.com/alchemyyy/webgpu-player-decoders/releases/download/v0.1.1/';
export const audioSourceFiles = [
  'FFmpeg-COPYING.LGPLv2.1', 'libdcadec-COPYING.LGPLv2.1',
  'ffmpeg-a59498db085e3d635532397128550141ab87408a.tar.gz',
  'dcadec-b93deed1a231dd6dd7e39b9fe7d2abe05aa00158.tar.gz',
  'webgpu-player-decoders-672c83e67ce2.tar.gz',
] as const;

export function canonicalAudioCodec(codec: string): string {
  const token = codec.trim().toLowerCase();
  if (token.startsWith('mp4a.40.')) return 'aac';
  const pcm = /^pcm-([suf])(8|16|24|32|64)(be)?$/.exec(token);
  if (pcm) return `pcm_${pcm[1]}${pcm[2]}${Number(pcm[2]) === 8 ? '' : (pcm[3] ?? 'le')}`;
  if (token === 'ulaw') return 'pcm_mulaw';
  if (token === 'alaw') return 'pcm_alaw';
  if (['dts', 'dtsc', 'dtsh', 'dtsl', 'dts-hd ma', 'dts_hd_ma'].includes(token)) return 'dts';
  return ({ 'a_ac3': 'ac3', 'ac-3': 'ac3', 'ec-3': 'eac3', 'e-ac-3': 'eac3',
    'a_eac3': 'eac3', 'a_truehd': 'truehd', 'a_dts': 'dts', 'a_flac': 'flac',
    'a_alac': 'alac', 'a_opus': 'opus', 'a_vorbis': 'vorbis', 'a_aac': 'aac',
    'a_mpeg/l3': 'mp3', 'mp4a.69': 'mp3', 'mp4a.6b': 'mp3' } as Record<string, string>)[token] ?? token;
}
export function packageForCodec(codec: string): AudioPackageId | null {
  const canonical = canonicalAudioCodec(codec);
  for (const id of Object.keys(audioPackages) as AudioPackageId[])
    if ((audioPackages[id].codecs as readonly string[]).includes(canonical)) return id;
  return null;
}

/** The upstream loader validates the manifest, ABI exports, imports and memory bound. */
export interface LoadedAudioPackage {
  kind: 'audio'; id: string;
  manifest: { codecs: readonly string[] };
}
export class AudioPackageRegistry<P extends LoadedAudioPackage> {
  private loaded = new Map<AudioPackageId, P>();
  constructor(private baseURL: string, private loadPackage: (bytes: ArrayBuffer) => Promise<P>,
    private fetchBytes: typeof fetch = (...args) => globalThis.fetch(...args)) {}

  async load(codec: string, signal: AbortSignal): Promise<{ codec: string; source: P } | null> {
    const id = packageForCodec(codec);
    if (!id) return null;
    const canonical = canonicalAudioCodec(codec);
    let source = this.loaded.get(id);
    if (!source) {
      const entry = audioPackages[id];
      const url = new URL(entry.file, this.baseURL.endsWith('/') ? this.baseURL : this.baseURL + '/');
      const response = await this.fetchBytes(url, { signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Audio decoder ${id}: HTTP ${response.status}`);
      // These packages are small; cap response size before compiling executable code.
      if (Number(response.headers.get('Content-Length')) > 32 * 1024 * 1024) throw new Error('Audio decoder exceeds size bound');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('Audio decoder exceeds size bound');
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const hash = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== entry.sha256) throw new Error(`Audio decoder ${id}: integrity mismatch`);
      source = await this.loadPackage(bytes);
      signal.throwIfAborted();
      if (source.kind !== 'audio' || source.id !== id || !source.manifest.codecs.includes(canonical))
        throw new Error(`Audio decoder ${id}: manifest mismatch`);
      this.loaded.set(id, source);
    }
    signal.throwIfAborted();
    return { codec: canonical, source };
  }
}
