import {
  hasHEVCRASLPicture,
  hasHEVCSPS,
  sanitizeHEVCAccessUnitForChromium,
  rewriteHEVCAccessUnitSPS,
  rewriteHEVCAccessUnitColorDescriptionToBT709,
  type HEVCNALFormat,
  type HEVCLengthSize,
} from '../../../../vendor/webgpu-player/src/demux/dolby-vision/DolbyVisionHEVCSplitter';
import {
  repairHEVCSPSDefaultDisplayWindow,
  type HEVCHDRTransfer,
} from '../../../../vendor/webgpu-player/src/demux/hevc/HEVCSPSParser';
import { findHEVCPreferredTransferCharacteristics } from '../../../../vendor/webgpu-player/src/demux/hevc/HEVCSEI';
import {
  neutralizeNativeHDRHEVCDecoderConfigWithValidation,
  repairHEVCDecoderConfigDefaultDisplayWindow,
} from '../../../../vendor/webgpu-player/src/decode/video/native/NativeHDRHEVCColorNeutralizer';
import type { VideoTrack } from '../types';

/** Native HEVC bitstream preparation, using parser functions as libraries.
 * Neutralizing VUI/config is required before the validated external HDR shader:
 * otherwise the browser converts HDR once and our tone mapper converts it again. */
export function prepareNativeHEVC(track: VideoTrack, configuration: VideoDecoderConfig) {
  if (track.codec !== 'hevc') return undefined;
  const description = configuration.description;
  const bytes = description
    ? ArrayBuffer.isView(description)
      ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
      : new Uint8Array(description)
    : null;
  const format: HEVCNALFormat =
    bytes && bytes.length >= 23 && bytes[0] === 1
      ? { kind: 'length-prefixed', lengthSize: ((bytes[21] & 3) + 1) as HEVCLengthSize }
      : { kind: 'annex-b' };
  const transfer: HEVCHDRTransfer | null = ['pq', 'smpte2084'].includes(String(track.color.transfer))
    ? 'pq'
    : ['hlg', 'arib-std-b67'].includes(String(track.color.transfer))
      ? 'hlg'
      : null;
  const neutral = transfer
    ? neutralizeNativeHDRHEVCDecoderConfigWithValidation(configuration, transfer)
    : null;
  const config = neutral?.configuration ?? repairHEVCDecoderConfigDefaultDisplayWindow(configuration);
  let validated = neutral?.decoderDescriptionValidated ?? false,
    packets = 0,
    leading = true;
  return {
    configuration: config,
    packet(input: Uint8Array): Uint8Array | null {
      // CRA random access can carry leading RASL pictures from before this GOP.
      if (packets > 0 && leading) {
        if (hasHEVCRASLPicture(input, format)) return null;
        leading = false;
      }
      let data = input;
      if (packets === 0) {
        const cleaned = sanitizeHEVCAccessUnitForChromium(data, format);
        if (cleaned) {
          if (!cleaned.length) return null;
          data = cleaned;
        }
      }
      if (hasHEVCSPS(data, format)) {
        if (transfer) {
          let preferred: number | null = null;
          try {
            preferred = findHEVCPreferredTransferCharacteristics(data, format);
          } catch (error) {
            if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
          }
          const rewritten = rewriteHEVCAccessUnitColorDescriptionToBT709(data, format, transfer, preferred);
          if (rewritten) {
            validated = true;
            data = rewritten;
          }
        } else data = rewriteHEVCAccessUnitSPS(data, format, repairHEVCSPSDefaultDisplayWindow) ?? data;
      }
      if (transfer && !validated) throw new Error('Native HDR requires validated source SPS colour');
      packets++;
      return data;
    },
    validateFrame(frame: VideoFrame) {
      if (
        transfer &&
        (frame.format !== null ||
          frame.colorSpace.primaries !== 'bt709' ||
          frame.colorSpace.matrix !== 'bt709' ||
          frame.colorSpace.transfer !== 'iec61966-2-1' ||
          frame.colorSpace.fullRange !== config.colorSpace?.fullRange)
      )
        throw new Error('Native HDR output differs from the validated opaque-frame contract');
    },
  };
}
