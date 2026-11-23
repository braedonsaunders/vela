import type { PlaybackFormat } from '../format-info';
import type { VideoInfo } from '../video-info';
import type { Track } from '../model';

/** The browser's own <video> (MSE or native HLS) says only what the rendition declared; it decodes
 * and outputs audio itself and does not say how. */
export function browserFormat(video: VideoInfo | null, audio: Track | undefined): PlaybackFormat | null {
  if (!video?.codec && !audio) return null;
  return {
    video: video?.codec
      ? {
          codec: video.codec,
          width: video.width,
          height: video.height,
          ...(video.dynamicRange ? { range: video.dynamicRange } : {}),
        }
      : null,
    videoOut: video?.codec ? { frameRateMatch: 'unsupported', rangeMatch: 'unsupported' } : null,
    audio: audio?.codec
      ? {
          codec: audio.codec,
          ...(audio.channels ? { channels: audio.channels } : {}),
          ...(audio.language ? { language: audio.language } : {}),
        }
      : null,
    audioOut: audio ? { delivery: 'system' } : null,
  };
}
