import { expect, test } from 'bun:test';
import { fragmentStart, initFacts } from '../web/engine/init-codecs';

// Small ISO BMFF builders: just the fields the reader looks at, laid out as a muxer writes them.
const u8 = (...bytes: number[]) => Uint8Array.from(bytes);
const u16 = (n: number) => u8(n >> 8, n & 0xff);
const u32 = (n: number) => u8(n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
const zeros = (n: number) => new Uint8Array(n);
function join(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
const box = (type: string, ...body: Uint8Array[]) => {
  const content = join(...body);
  return join(u32(content.length + 8), new TextEncoder().encode(type), content);
};
const full = (type: string, version: number, ...body: Uint8Array[]) => box(type, u8(version, 0, 0, 0), ...body);

function trak(id: number, handler: 'vide' | 'soun', timescale: number, entry: Uint8Array) {
  return box(
    'trak',
    full('tkhd', 0, u32(0), u32(0), u32(id), zeros(68)),
    box(
      'mdia',
      full('mdhd', 0, u32(0), u32(0), u32(timescale), u32(0), zeros(4)),
      full('hdlr', 0, u32(0), new TextEncoder().encode(handler), zeros(13)),
      box('minf', box('stbl', full('stsd', 0, u32(1), entry))),
    ),
  );
}
const visual = (type: string, config: Uint8Array) => box(type, zeros(78), config);
const audio = (type: string, ...config: Uint8Array[]) => box(type, zeros(28), ...config);
// esds: ES_Descriptor > DecoderConfigDescriptor (AAC, object type 0x40) > DecoderSpecificInfo (AOT 2 or 5).
const esds = (audioObjectType: number) =>
  full(
    'esds',
    0,
    u8(3, 25, 0, 1, 0),
    u8(4, 17, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    u8(5, 2, (audioObjectType << 3) | 1, 0x90),
    u8(6, 1, 2),
  );
const init = (...traks: Uint8Array[]) => join(box('ftyp', new TextEncoder().encode('isom'), u32(0)), box('moov', ...traks)).buffer;

test("Ether's live init: H.264 High 3.1 and AAC-LC, with each track's timescale", () => {
  const facts = initFacts(
    init(trak(1, 'vide', 90000, visual('avc1', box('avcC', u8(1, 0x64, 0x00, 0x1f, 0xff)))), trak(2, 'soun', 48000, audio('mp4a', esds(2)))),
  );
  expect(facts?.mime).toBe('video/mp4; codecs="avc1.64001F,mp4a.40.2"');
  expect([...facts!.timescales]).toEqual([[1, 90000], [2, 48000]]);
});

test('HEVC, AV1 and VP9 sample entries give their RFC 6381 strings', () => {
  // HEVC Main, compatibility flags 0x60000000 (written bit-reversed), level 3.1, progressive source.
  const hvcC = box('hvcC', u8(1, 0x01), u32(0x60000000), u8(0x90, 0, 0, 0, 0, 0), u8(93));
  expect(initFacts(init(trak(1, 'vide', 24000, visual('hvc1', hvcC))))?.mime).toBe('video/mp4; codecs="hvc1.1.6.L93.90"');
  // AV1 Main, level 5, Main tier, 10-bit.
  const av1C = box('av1C', u8(0x81, (0 << 5) | 8, 0x40, 0));
  expect(initFacts(init(trak(1, 'vide', 24000, visual('av01', av1C))))?.mime).toBe('video/mp4; codecs="av01.0.08M.10"');
  const vpcC = full('vpcC', 1, u8(2, 31, 10 << 4), zeros(5));
  expect(initFacts(init(trak(1, 'vide', 24000, visual('vp09', vpcC))))?.mime).toBe('video/mp4; codecs="vp09.02.31.10"');
});

test('audio-only, HE-AAC and the named audio codecs', () => {
  expect(initFacts(init(trak(1, 'soun', 44100, audio('mp4a', esds(5)))))?.mime).toBe('audio/mp4; codecs="mp4a.40.5"');
  expect(initFacts(init(trak(1, 'soun', 48000, audio('ec-3'))))?.mime).toBe('audio/mp4; codecs="ec-3"');
  expect(initFacts(init(trak(1, 'soun', 48000, audio('Opus'))))?.mime).toBe('audio/mp4; codecs="opus"');
});

test('an encrypted, codec-less or truncated init is unreadable, not guessed', () => {
  expect(initFacts(init(trak(1, 'vide', 90000, visual('encv', box('sinf')))))).toBeNull();
  expect(initFacts(init(trak(1, 'vide', 90000, visual('avc1', box('free')))))).toBeNull();
  expect(initFacts(box('ftyp', zeros(8)).buffer)).toBeNull();
  const whole = new Uint8Array(init(trak(1, 'vide', 90000, visual('avc1', box('avcC', u8(1, 0x64, 0, 0x1f))))));
  expect(initFacts(whole.slice(0, whole.length - 20).buffer)).toBeNull();
});

test("a fragment's start is its first track's tfdt in that track's timescale", () => {
  const timescales = new Map([[1, 90000], [2, 48000]]);
  const traf = (id: number, version: 0 | 1, time: number) =>
    box('traf', full('tfhd', 0, u32(id)), full('tfdt', version, ...(version ? [u32(Math.floor(time / 2 ** 32)), u32(time >>> 0)] : [u32(time)])));
  const segment = (...trafs: Uint8Array[]) => join(box('styp', zeros(8)), box('moof', full('mfhd', 0, u32(1)), ...trafs), box('mdat', zeros(4))).buffer;
  expect(fragmentStart(segment(traf(1, 0, 900000), traf(2, 0, 480000)), timescales)).toBe(10);
  // 64-bit decode times (a long-running live encoder).
  expect(fragmentStart(segment(traf(1, 1, 90000 * 100000)), timescales)).toBe(100000);
  expect(fragmentStart(segment(traf(3, 0, 1)), timescales)).toBeNull();
  expect(fragmentStart(box('mdat').buffer, timescales)).toBeNull();
});
