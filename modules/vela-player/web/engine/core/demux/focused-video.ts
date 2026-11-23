import type { InputVideoTrack } from 'mediabunny';
import { readMPEG4TrackConfiguration, type MPEG4TrackCodec } from 'webgpu-player/src/demux/mpeg4/MPEG4TrackConfiguration';
import { readVC1TrackConfiguration } from 'webgpu-player/src/demux/vc1/VC1TrackConfiguration';

const MPEG4_FAMILY = new Set(['mpeg4', 'h263', 'msmpeg4v1', 'msmpeg4v2', 'msmpeg4v3']);

/** Upstream's track configuration for the codecs whose packages need more than CodecPrivate.
 * Null for other codecs; a track whose configuration cannot be read is refused here rather than
 * failing later inside the package's parser. */
export async function focusedVideoConfiguration(
  codec: string,
  track: InputVideoTrack,
  internalCodecId: unknown,
  codedWidth: number,
  codedHeight: number,
): Promise<{ description: Uint8Array; videoTrack: InputVideoTrack } | null> {
  if (typeof internalCodecId !== 'string') return null;
  const configuration = MPEG4_FAMILY.has(codec)
    ? await readMPEG4TrackConfiguration(codec as MPEG4TrackCodec, track, {
        fourCCCodecID: false,
        codedWidth,
        codedHeight,
        containerCodec: await track.getCodec(),
        internalCodecID: internalCodecId,
      })
    : codec === 'vc1' || codec === 'wmv3'
      ? await readVC1TrackConfiguration(codec, track, internalCodecId, codedWidth, codedHeight)
      : null;
  if (!configuration) return null;
  if (configuration.status === 'failed')
    throw new Error(`The ${codec} track has no decoder configuration: ${configuration.failure}`);
  return { description: configuration.description, videoTrack: configuration.videoTrack ?? track };
}
