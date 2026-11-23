/** Facts read from a video track's decoder configuration, kept free of decoder and WebGPU imports
 * so routing rules can be tested on their own. */
import type { GPUDecoderOutputFormat } from 'webgpu-player/src/decode/video/gpu/GPUDecodeFormats';
import type { VideoTrack } from '../types';

/** Bit depth from an av1C record (AV1-ISOBMFF 2.3.3): high_bitdepth, then twelve_bit. */
export function av1BitDepth(description: Uint8Array | null): number | null {
  if (!description || description.length < 4 || description[0] !== 0x81) return null;
  const high = (description[2] >> 6) & 1,
    twelve = (description[2] >> 5) & 1;
  return high ? (twelve ? 12 : 10) : 8;
}

const EIGHT_BIT_420 = new Set(['mpeg1video', 'mpeg2video', 'mpeg4', 'h263', 'msmpeg4v1', 'msmpeg4v2', 'msmpeg4v3', 'vc1', 'wmv3']);

function description(track: VideoTrack): Uint8Array | null {
  const value = track.config?.description;
  if (!value) return null;
  return ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value as ArrayBuffer);
}

/** The frame-pool format a package writes for the track, from the configuration it carries: HEVC's
 * hvcC chroma and depth, AV1's av1C (8-bit 4:2:0 without one), and 4:2:0 for the 8-bit codecs, whose
 * 4:2:2 profiles the package itself rejects. */
export function packageOutputFormat(track: VideoTrack): GPUDecoderOutputFormat | null {
  const bytes = description(track);
  const named = (chroma: number, depth: number) =>
    ((chroma === 2 ? 'I422' : chroma === 3 ? 'I444' : 'I420') + (depth === 8 ? '' : `P${depth}`)) as GPUDecoderOutputFormat;
  if (track.codec === 'hevc') {
    if (!bytes || bytes.length < 23 || bytes[0] !== 1) return null;
    return named(bytes[16] & 3, 8 + (bytes[17] & 7));
  }
  if (track.codec === 'av1') {
    if (!bytes || bytes.length < 4 || bytes[0] !== 0x81) return null;
    const high = (bytes[2] >> 6) & 1,
      twelve = (bytes[2] >> 5) & 1,
      mono = (bytes[2] >> 4) & 1,
      x = (bytes[2] >> 3) & 1,
      y = (bytes[2] >> 2) & 1;
    if (mono) return null;
    return named(x && y ? 1 : x ? 2 : 3, high ? (twelve ? 12 : 10) : 8);
  }
  return EIGHT_BIT_420.has(track.codec) ? 'I420' : null;
}


/** Packages qualified only in Chromium: WebKit's WGSL compiler rejects the MPEG-1/2 shaders, and its
 * AV1 package decode froze the picture after a dozen frames while audio ran on. There the server's
 * fallback plays instead. */
const CHROMIUM_PACKAGES = new Set(['av1', 'mpeg1video', 'mpeg2video']);

function chromium(): boolean {
  const brands = (globalThis.navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } } | undefined)
    ?.userAgentData?.brands;
  return !!brands?.some((entry) => entry.brand === 'Chromium');
}

export function packageRoute(track: VideoTrack, isChromium = chromium()): boolean {
  return packageOutputFormat(track) !== null && (isChromium || !CHROMIUM_PACKAGES.has(track.codec));
}

