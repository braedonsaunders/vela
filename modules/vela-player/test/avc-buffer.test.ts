import { expect, test } from 'bun:test';
import { avcDecodedPictureBufferFrames } from '../web/engine/core/decode/avc-buffer';

function bytes(hex: string) {
  return new Uint8Array(hex.match(/../g)!.map((value) => Number.parseInt(value, 16)));
}

function configuration(spsHex: string): VideoDecoderConfig {
  const sps = bytes(spsHex);
  const description = new Uint8Array(8 + sps.length);
  description.set([1, sps[1]!, sps[2]!, sps[3]!, 0xff, 0xe1, sps.length >> 8, sps.length & 0xff]);
  description.set(sps, 8);
  return { codec: `avc1.${sps[1]!.toString(16)}${sps[2]!.toString(16)}${sps[3]!.toString(16)}`, description };
}

test('AVC without a bitstream restriction derives the 960x540 Level 3.1 eight-frame DPB', () => {
  // x264 Main@L3.1 SPS with bitstream_restriction_flag=0:
  // 60 * 34 macroblocks, floor(18000 / 2040) = 8.
  expect(
    avcDecodedPictureBufferFrames(configuration('674d401feca07808bf780880000003008000001e02')),
  ).toBe(8);
});
test('AVC honors max_dec_frame_buffering when the SPS carries a bitstream restriction', () => {
  // The equivalent x264 960x540 SPS explicitly signals four buffered frames.
  expect(
    avcDecodedPictureBufferFrames(configuration('674d401feca07808bf780880000003008000001e078c18cb')),
  ).toBe(4);
});

test('AVC never infers a DPB below the SPS reference-frame requirement', () => {
  // Baseline 1080p L3.1 is under-signalled by level, but declares four reference frames.
  expect(avcDecodedPictureBufferFrames(configuration('6742c01fd940780227e540'))).toBe(4);
});
