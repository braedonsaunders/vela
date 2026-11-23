import { parseAV1OBUs } from 'webgpu-player/src/demux/av1/AV1OBUParser';
import {
  NativeHDRAV1TemporalUnitNeutralizer,
  neutralizeNativeHDRAV1DecoderConfig,
} from 'webgpu-player/src/decode/video/native/NativeHDRAV1ColorNeutralizer';
import type { VideoTrack } from '../types';
import { av1BitDepth } from './codec-config';

function bytes(source: AllowSharedBufferSource | undefined): Uint8Array | null {
  if (!source) return null;
  return ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source as ArrayBuffer);
}

/** Native AV1 HDR preparation, the AV1 counterpart of prepareNativeHEVC: the sequence header's
 * colour is rewritten to limited BT.709 so the browser hands over untouched 10-bit values, and the
 * validated external HDR shader converts them once. SDR AV1 passes through untouched. */
export function prepareNativeAV1(track: VideoTrack, configuration: VideoDecoderConfig) {
  if (track.codec !== 'av1') return undefined;
  const transfer = ['pq', 'smpte2084'].includes(String(track.color.transfer))
    ? ('pq' as const)
    : ['hlg', 'arib-std-b67'].includes(String(track.color.transfer))
      ? ('hlg' as const)
      : null;
  if (!transfer) return undefined;
  const neutral = neutralizeNativeHDRAV1DecoderConfig(configuration, transfer);
  const units = new NativeHDRAV1TemporalUnitNeutralizer(transfer, neutral.decoderDescriptionValidated);
  const config = neutral.configuration;
  return {
    configuration: config,
    bitDepth: av1BitDepth(bytes(configuration.description)),
    packet(input: Uint8Array): Uint8Array | null {
      return units.neutralize(input, parseAV1OBUs(input)).data;
    },
    validateFrame(frame: VideoFrame) {
      if (
        frame.format !== null ||
        frame.colorSpace.primaries !== 'bt709' ||
        frame.colorSpace.matrix !== 'bt709' ||
        frame.colorSpace.transfer !== 'iec61966-2-1' ||
        frame.colorSpace.fullRange !== config.colorSpace?.fullRange
      )
        throw new Error('Native HDR output differs from the validated opaque-frame contract');
    },
  };
}
