import { expect, test } from 'bun:test';
import { decodeVobSub, parseVobSubIdx } from '../web/engine/universal/subtitles/vobsub';

/** One 4×2 subpicture: the top line a run of colour 1, the bottom line filled with colour 2. */
function spu(): Uint8Array {
  const data = [0x11, 0x00, 0x02];
  const control = 4 + data.length;
  const first = [0x00, 0x00, 0, 0, 0x03, 0x32, 0x10, 0x04, 0xff, 0xf0, 0x05, 0x00, 0x00, 0x03, 0x00, 0x00, 0x01, 0x06, 0x00, 0x04, 0x00, 0x05, 0x01, 0xff];
  const second = control + first.length;
  first[2] = second >> 8;
  first[3] = second & 255;
  const last = [0x00, 0x5a, second >> 8, second & 255, 0x02, 0xff];
  const size = second + last.length;
  return new Uint8Array([size >> 8, size & 255, control >> 8, control & 255, ...data, ...first, ...last]);
}

test('the idx gives the frame size and the 16-colour palette', () => {
  const idx = new TextEncoder().encode(
    '# VobSub index file, v7\nsize: 720x576\npalette: 000000, ffffff, 808080, ff0000, 00ff00, 0000ff, 111111, 222222, 333333, 444444, 555555, 666666, 777777, 888888, 999999, aaaaaa\n',
  );
  expect(parseVobSubIdx(idx)).toMatchObject({ width: 720, height: 576, palette: expect.arrayContaining([0xffffff, 0xff0000]) });
  expect(parseVobSubIdx(idx).palette[3]).toBe(0xff0000);
  expect(parseVobSubIdx(null)).toMatchObject({ width: 720, height: 480 });
});

test('a subpicture decodes to its area, colours, contrast and display times', () => {
  const palette = Array.from({ length: 16 }, (_, n) => (n === 1 ? 0xffffff : n === 2 ? 0xff0000 : 0x000000));
  const cue = decodeVobSub(spu(), 10, { width: 720, height: 480, palette }, null)!;
  expect(cue.start).toBe(10);
  expect(cue.end).toBeCloseTo(10 + (90 * 1024) / 90000, 6);
  expect(cue.forced).toBe(false);
  const bitmap = cue.display.bitmaps[0];
  expect([bitmap.x, bitmap.y, bitmap.width, bitmap.height]).toEqual([0, 0, 4, 2]);
  // Top line: pixel value 1 → palette index 1 (white), opaque.
  expect([...bitmap.rgba.slice(0, 4)]).toEqual([255, 255, 255, 255]);
  // Bottom line: pixel value 2 → palette index 2 (red), opaque.
  expect([...bitmap.rgba.slice(16, 20)]).toEqual([255, 0, 0, 255]);
  expect(() => decodeVobSub(new Uint8Array([0, 8, 0, 9, 0, 0, 0, 0]), 0, { width: 720, height: 480, palette }, null)).toThrow();
});

test('an SPU a muxer split across two packets is joined before decoding', async () => {
  const { joinVobSubPackets } = await import('../web/engine/universal/subtitles/vobsub');
  const whole = spu();
  const joined = joinVobSubPackets([
    { time: 3, duration: null, data: whole.subarray(0, 10) },
    { time: 3.2, duration: null, data: whole.subarray(10) },
    { time: 9, duration: 2, data: whole },
  ]);
  expect(joined).toHaveLength(2);
  expect(joined[0].time).toBe(3);
  expect([...joined[0].data]).toEqual([...whole]);
  expect(joined[1].time).toBe(9);
});
