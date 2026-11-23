import {
  splitDolbyVisionHEVCAccessUnit,
  type HEVCLengthSize,
  type HEVCNALFormat,
} from 'webgpu-player/src/demux/dolby-vision/DolbyVisionHEVCSplitter';
import type { VideoTrack } from '../types';

/** For a dual-layer Dolby Vision (profile 7) HEVC track, the filter that keeps each access unit's
 * base layer: the enhancement layer (wrapped in NAL type 63 or carried at nuh_layer_id 1) and the
 * RPU are dropped, as upstream's splitter does, so the decoder sees a plain HDR10 stream. */
export function baseLayerFilter(track: VideoTrack): ((data: Uint8Array) => Uint8Array | null) | null {
  if (track.codec !== 'hevc') return null;
  const description = track.config?.description;
  const bytes = description
    ? ArrayBuffer.isView(description)
      ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
      : new Uint8Array(description as ArrayBuffer)
    : null;
  const format: HEVCNALFormat =
    bytes && bytes.length >= 23 && bytes[0] === 1
      ? { kind: 'length-prefixed', lengthSize: ((bytes[21] & 3) + 1) as HEVCLengthSize }
      : { kind: 'annex-b' };
  return (data) => splitDolbyVisionHEVCAccessUnit(data, format).baseLayerData;
}
