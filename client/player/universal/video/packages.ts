import { loadDecoderPackage, type VideoDecoderPackage } from '../../../../vendor/webgpu-player/src/decode/packages/DecoderPackage';
import pins from '../../../../vendor/webgpu-player/tools/pinned-releases.json';
const packages = {
  hevc:['hevc'], av1:['av1'], mpeg2:['mpeg1video','mpeg2video'],
  mpeg4:['mpeg4','h263','msmpeg4v1','msmpeg4v2','msmpeg4v3'],
  vc1:['vc1','wmv3'], jpeg2000:['jpeg2000'], uncompressed:['rawvideo'],
} as const;
export type VideoPackageId = keyof typeof packages;
export function videoPackageId(codec: string): VideoPackageId | null {
  const value = codec.toLowerCase();
  const canonical = ({h265:'hevc',av01:'av1',mjpeg2000:'jpeg2000'} as Record<string,string>)[value] ?? value;
  return (Object.keys(packages) as VideoPackageId[]).find(id => (packages[id] as readonly string[]).includes(canonical)) ?? null;
}
/** Packages are installed, immutable assets. Exact profile/geometry/format and
 * device fit are checked by the upstream offer/route authorization afterwards. */
export class VideoPackages {
  private loaded = new Map<VideoPackageId, VideoDecoderPackage>();
  constructor(private baseURL: string) {}
  async load(codec: string, signal: AbortSignal): Promise<VideoDecoderPackage | null> {
    signal.throwIfAborted();
    const id = videoPackageId(codec); if (!id) return null;
    const cached = this.loaded.get(id); if (cached) return cached;
    const file = `${id}.wasm` as keyof typeof pins.decoders.files;
    const response = await fetch(new URL(file,this.baseURL),{credentials:'same-origin',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
    if (!response.ok) throw new Error(`Video decoder ${id}: HTTP ${response.status}`);
    if (Number(response.headers.get('Content-Length')) > 32*1024*1024) throw new Error('Video decoder package exceeds size bound');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 32*1024*1024) throw new Error('Video decoder package exceeds size bound');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    if (Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('') !== pins.decoders.files[file]) throw new Error(`Video decoder ${id}: integrity mismatch`);
    const decoder = await loadDecoderPackage(bytes); signal.throwIfAborted();
    if (decoder.kind !== 'video' || decoder.id !== id) throw new Error(`Video decoder ${id}: manifest mismatch`);
    this.loaded.set(id,decoder); return decoder;
  }
}
