import { expect, test } from 'bun:test';
import { keptFrames, locateMoov, readLame, readMoov, readTrimFacts, trimFor } from '../web/gapless/trim';

// A gapless player drops the encoder's delay and padding: read from LAME's header for MP3, from the
// edit list (or iTunes' iTunSMPB note) for AAC in MP4.

const ascii = (value: string) => [...value].map(ch => ch.charCodeAt(0));
const be32 = (value: number) => [value >>> 24 & 255, value >>> 16 & 255, value >>> 8 & 255, value & 255];
const be16 = (value: number) => [value >>> 8 & 255, value & 255];

/** An MPEG-1 Layer III stereo frame at 44.1 kHz carrying a Xing/Info header and a LAME tag. */
function lameFrame(frames: number, delay: number, padding: number, encoder = 'LAME'): number[] {
  const frame = new Array(417).fill(0);
  frame.splice(0, 4, 0xff, 0xfb, 0x90, 0x00);
  const xing = [...ascii('Info'), ...be32(0x0f), ...be32(frames), ...be32(123456), ...new Array(100).fill(0), ...be32(80)];
  const lame = [...ascii(encoder), ...ascii('3.100'), ...new Array(12).fill(0), delay >> 4, (delay & 15) << 4 | padding >> 8, padding & 255];
  frame.splice(36, xing.length + lame.length, ...xing, ...lame);
  return frame;
}

function id3(size: number): number[] {
  return [...ascii('ID3'), 4, 0, 0, size >> 21 & 127, size >> 14 & 127, size >> 7 & 127, size & 127, ...new Array(size).fill(0)];
}

test('LAME delay and padding give the real length of an MP3, after an ID3 tag', () => {
  const lame = readLame(new Uint8Array([...id3(300), ...lameFrame(281, 576, 1206)]));
  expect(lame).toEqual({ delay: 576, padding: 1206, frames: 281, samplesPerFrame: 1152, sampleRate: 44100 });
  // 281 frames of 1152 samples less delay and padding: 321,930 samples.
  expect(trimFor('mp3', { lame }, 7.33).end * 44100).toBeCloseTo(321_930, 6);
  expect(readLame(new Uint8Array(lameFrame(10, 576, 1000, 'Lavc')))?.padding).toBe(1000);
});

test('an MP3 without a gapless header plays its whole decoded length', () => {
  const frame = lameFrame(10, 0, 0);
  frame.splice(36, 4, ...ascii('Nope'));
  expect(readLame(new Uint8Array(frame))).toBeNull();
  expect(trimFor('mp3', { lame: null }, 12.5)).toEqual({ start: 0, end: 12.5 });
  expect(trimFor('other', {}, 0)).toEqual({ start: 0, end: Infinity });
});

const box = (type: string, ...body: number[][]) => { const content = body.flat(); return [...be32(8 + content.length), ...ascii(type), ...content]; };
const full = (version: number) => [version, 0, 0, 0];

/** A moov with one sound track: movie timescale 1000, media 44100, an edit and (optionally) an iTunSMPB note. */
function moov(options: { edit?: [number, number]; itunes?: string } = {}): number[] {
  const mvhd = box('mvhd', full(0), be32(0), be32(0), be32(1000), be32(7300), new Array(80).fill(0));
  const mdhd = box('mdhd', full(0), be32(0), be32(0), be32(44100), be32(323584), be16(0), be16(0));
  const hdlr = box('hdlr', full(0), be32(0), ascii('soun'), new Array(12).fill(0), [0]);
  const entry = box('mp4a', new Array(6).fill(0), be16(1), new Array(8).fill(0), be16(2), be16(16), be16(0), be16(0), be32(44100 * 65536), box('esds', full(0)));
  const stbl = box('stbl', box('stsd', full(0), be32(1), entry));
  const mdia = box('mdia', mdhd, hdlr, box('minf', stbl));
  const edts = options.edit ? box('edts', box('elst', full(0), be32(1), be32(options.edit[0]), be32(options.edit[1]), be32(0x10000))) : [];
  const trak = box('trak', box('tkhd', full(0), new Array(80).fill(0)), edts, mdia);
  const udta = options.itunes ? box('udta', box('meta', full(0), box('ilst', box('----',
    box('mean', full(0), ascii('com.apple.iTunes')), box('name', full(0), ascii('iTunSMPB')), box('data', be32(1), be32(0), ascii(options.itunes)))))) : [];
  return box('moov', mvhd, trak, udta);
}

test('an MP4 edit list bounds the AAC track: the media start is skipped, the edit length plays', () => {
  const facts = readMoov(new Uint8Array(moov({ edit: [7300, 1024] })));
  expect(facts?.edit).toEqual({ mediaStart: 1024 / 44100, duration: 7.3 });
  expect(facts?.sampleRate).toBe(44100);
  expect(trimFor('mp4', { mp4: facts }, 7.31)).toEqual({ start: 0, end: 7.3 });
});

test("iTunes' gapless note bounds a track with no edit list", () => {
  const facts = readMoov(new Uint8Array(moov({ itunes: ' 00000000 00000840 000001CA 000000000004E98A 00000000 00000000' })));
  expect(facts?.itunes).toEqual({ priming: 0x840, padding: 0x1ca, samples: 321_930 });
  const trim = trimFor('mp4', { mp4: facts }, 7.4);
  expect(trim.start * 44100).toBeCloseTo(2112, 6);
  expect((trim.end - trim.start) * 44100).toBeCloseTo(321_930, 6);
});

test('a moov after the media is found by walking the top-level boxes and read on its own', async () => {
  const file = new Uint8Array([...box('ftyp', ascii('M4A '), be32(0)), ...box('mdat', new Array(300_000).fill(9)), ...moov({ edit: [6850, 1024] })]);
  const reads: [number, number][] = [];
  const facts = await readTrimFacts('mp4', async (start, end) => { reads.push([start, end]); return file.subarray(start, Math.min(end, file.length)); });
  expect(facts.mp4?.edit?.duration).toBe(6.85);
  // The head, the moov's header past it, then the moov itself.
  expect(reads.length).toBe(3);
  expect(reads[2]![0]).toBe(16 + 8 + 300_000);
});

test('a moov inside the head is read from it', async () => {
  const file = new Uint8Array([...box('ftyp', ascii('M4A '), be32(0)), ...moov({ edit: [7300, 1024] }), ...box('mdat', new Array(100).fill(9))]);
  expect(await locateMoov(async () => new Uint8Array(), file)).toEqual({ start: 16, end: 16 + moov({ edit: [7300, 1024] }).length });
});

test('a decoded block keeps only the frames inside the real audio, joining its neighbours exactly', () => {
  const rate = 44100;
  // AAC primed by 1024 samples: the first block starts before zero and loses its priming.
  expect(keptFrames(-1024 / rate, 1024, rate, 0, 7.3)).toEqual([1024, 1024]);
  expect(keptFrames(0, 1024, rate, 0, 7.3)).toEqual([0, 1024]);
  // The last block keeps up to the end: 321,930 samples in all.
  const lastStart = 314 * 1024 / rate;
  expect(keptFrames(lastStart, 1024, rate, 0, 7.3)).toEqual([0, 321_930 - 314 * 1024]);
  expect(keptFrames(315 * 1024 / rate, 1024, rate, 0, 7.3)).toEqual([0, 0]);
  // A seek into the middle of a block starts at the sample sought; an unknown end keeps everything.
  expect(keptFrames(1, 1152, rate, 1.01, Infinity)).toEqual([441, 1152]);
  let kept = 0;
  for (let block = -1; block < 320; block++) { const [a, b] = keptFrames(block * 1024 / rate, 1024, rate, 0, 7.3); kept += b - a; }
  expect(kept).toBe(321_930);
});
