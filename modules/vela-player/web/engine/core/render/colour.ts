import type { VideoTrack } from '../types';

/** The colour players assume for SDR video that declares none: HD is BT.709; SD is BT.601 with
 * PAL primaries for 576/288 lines and NTSC (SMPTE 170M) primaries otherwise. */
export function conventionalColour(track: Pick<VideoTrack, 'width' | 'height'>): {
  primaries: 'bt709' | 'bt470bg' | 'smpte170m';
  matrix: 'bt709' | 'bt470bg' | 'smpte170m';
} {
  if (track.height > 576 || track.width > 1024) return { primaries: 'bt709', matrix: 'bt709' };
  const pal = track.height === 576 || track.height === 288;
  return pal ? { primaries: 'bt470bg', matrix: 'bt470bg' } : { primaries: 'smpte170m', matrix: 'smpte170m' };
}
