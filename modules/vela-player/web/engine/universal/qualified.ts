/** Expand only after real playback qualification, never from package presence. */
/** AV1 and VP9 passed the format matrix (FORMATS.md) through WebCodecs: AV1 8-bit and 10-bit HDR10,
 * VP9 profile 0. VP9 profile 2 HDR has no validated colour route yet and falls back. */
export const QUALIFIED_ORIGINAL_VIDEO: readonly string[] = ['h264', 'hevc', 'av1', 'vp9'];
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
