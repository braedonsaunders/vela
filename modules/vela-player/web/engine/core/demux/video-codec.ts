/** FFmpeg codec names for the video tracks the core can hand to a decoder package, from what the
 * demuxer recognised or, where it recognised nothing, the container's own codec id. Matroska's
 * V_MS/VFW/FOURCC carries a BITMAPINFOHEADER whose compression FourCC names the codec; FFmpeg passes
 * the bytes after its 40-byte header to the decoder as extradata, and so does this. */
const MEDIABUNNY: Record<string, string> = {
  avc: 'h264',
  mpeg1: 'mpeg1video',
  mpeg2: 'mpeg2video',
};
const MATROSKA: Record<string, string> = {
  V_MPEG1: 'mpeg1video',
  V_MPEG2: 'mpeg2video',
  'V_MPEG4/ISO/ASP': 'mpeg4',
  'V_MPEG4/ISO/SP': 'mpeg4',
  'V_MPEG4/ISO/AP': 'mpeg4',
  'V_MPEG4/MS/V3': 'msmpeg4v3',
};
const FOURCC: Record<string, string> = {
  WVC1: 'vc1',
  WMV3: 'wmv3',
  XVID: 'mpeg4',
  DIVX: 'mpeg4',
  DX50: 'mpeg4',
  FMP4: 'mpeg4',
  MP4V: 'mpeg4',
  DIV3: 'msmpeg4v3',
  MP43: 'msmpeg4v3',
  MP42: 'msmpeg4v2',
  MPG4: 'msmpeg4v1',
  H263: 'h263',
  MPG2: 'mpeg2video',
};
const BITMAPINFOHEADER = 40;

export interface ContainerVideoCodec {
  codec: string;
  /** Decoder extradata, when the container wraps it (VfW) or the demuxer did not expose it. */
  extradata: Uint8Array | null;
}

export function containerVideoCodec(
  recognised: string | null,
  internalCodecId: unknown,
  codecPrivate: Uint8Array | null,
): ContainerVideoCodec {
  if (recognised) return { codec: MEDIABUNNY[recognised] ?? recognised, extradata: null };
  if (typeof internalCodecId !== 'string') return { codec: 'unknown', extradata: null };
  const id = internalCodecId.trim();
  if (MATROSKA[id]) return { codec: MATROSKA[id], extradata: codecPrivate?.length ? codecPrivate : null };
  if (id === 'V_MS/VFW/FOURCC' && codecPrivate && codecPrivate.length >= BITMAPINFOHEADER) {
    const fourcc = String.fromCharCode(...codecPrivate.subarray(16, 20)).toUpperCase();
    const codec = FOURCC[fourcc];
    if (codec)
      return {
        codec,
        extradata: codecPrivate.length > BITMAPINFOHEADER ? codecPrivate.slice(BITMAPINFOHEADER) : null,
      };
  }
  return { codec: 'unknown', extradata: null };
}
