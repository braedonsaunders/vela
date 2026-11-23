/** Expand only after real playback qualification, never from package presence. */
/** AV1 and VP9 passed the format matrix (FORMATS.md) through WebCodecs: AV1 8-bit and 10-bit HDR10,
 * VP9 profile 0. VP9 profile 2 HDR has no validated colour route yet and falls back. */
export const QUALIFIED_ORIGINAL_VIDEO: readonly string[] = ['h264', 'hevc', 'av1', 'vp9'];
/** Decoded only by the WebGPU packages (no WebCodecs registration). MPEG-1/2 (progressive and
 * interlaced), MPEG-4 Part 2 and MS-MPEG4 v3 passed the matrix in Chromium; WebKit's WGSL compiler
 * rejects the MPEG-2 package's shaders, so these are offered only where Chromium runs them. H.263
 * and MS-MPEG4 v1/v2 share the MPEG-4 package; VC-1/WMV3 have no encoder to qualify them with. */
export const QUALIFIED_CHROMIUM_PACKAGE_VIDEO: readonly string[] = [
  'mpeg1video',
  'mpeg2video',
  'mpeg4',
  'msmpeg4v3',
];
export const QUALIFIED_ORIGINAL_AUDIO: readonly string[] = [
  'aac',
  'ac3',
  'eac3',
  'truehd',
  'dts',
  'flac',
  'opus',
  'vorbis',
  'mp3',
  'alac',
  'mp2',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_s32le',
  'pcm_f32le',
  'pcm_f64le',
];
