import { describe, expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';
import { decodePng, encodePng, type Image } from '../png';
import { diffImages, findShift, groupRegions, inMask, maskCoverage, movingMask, needsMaskReview, verdict } from '../diff';
import { readerHasContent, settledFrames } from '../settle';

/** A w×h image of one colour, with optional filled rectangles drawn on it. */
function canvas(width: number, height: number, ground: number[], rects: { x: number; y: number; w: number; h: number; c: number[] }[] = []): Image {
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([...ground, 255], p * 4);
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) data.set([...r.c, 255], (y * width + x) * 4);
  return { width, height, data };
}
const BLACK = [10, 12, 20], WHITE = [240, 240, 240], RED = [200, 30, 40];

describe('png', () => {
  test('round-trips RGBA', () => {
    const image = canvas(7, 5, BLACK, [{ x: 1, y: 1, w: 3, h: 2, c: RED }]);
    image.data[3] = 128;
    const back = decodePng(encodePng(image));
    expect(back.width).toBe(7);
    expect(back.height).toBe(5);
    expect([...back.data]).toEqual([...image.data]);
  });

  test('reads RGB rows written with every filter', () => {
    // Two pixels per row, five rows, filters 0..4, as a browser may write them.
    const width = 2, height = 5;
    const rgb = [[10, 20, 30, 40, 50, 60], [11, 21, 31, 41, 51, 61], [12, 22, 32, 42, 52, 62], [13, 23, 33, 43, 53, 63], [14, 24, 34, 44, 54, 64]];
    const raw: number[] = [];
    const paeth = (a: number, b: number, c: number) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
    rgb.forEach((row, y) => {
      raw.push(y);
      row.forEach((value, x) => {
        const a = x >= 3 ? row[x - 3]! : 0, b = y ? rgb[y - 1]![x]! : 0, c = x >= 3 && y ? rgb[y - 1]![x - 3]! : 0;
        const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][y]!;
        raw.push((value - predicted) & 255);
      });
    });
    const header = new Uint8Array(13);
    new DataView(header.buffer).setUint32(0, width); new DataView(header.buffer).setUint32(4, height);
    header[8] = 8; header[9] = 2;
    const encoded = encodePng(canvas(1, 1, BLACK));
    // Re-use the encoder's chunk framing by swapping in an RGB header and body.
    const png = rebuild(encoded, header, new Uint8Array(deflateSync(Uint8Array.from(raw))));
    const image = decodePng(png);
    expect([...image.data.subarray(0, 8)]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
    expect([...image.data.subarray(32, 40)]).toEqual([14, 24, 34, 255, 44, 54, 64, 255]);
  });
});

/** A PNG with the given IHDR body and IDAT body, chunk CRCs ignored by the decoder. */
function rebuild(_template: Uint8Array, header: Uint8Array, idat: Uint8Array): Uint8Array {
  const parts: number[] = [137, 80, 78, 71, 13, 10, 26, 10];
  const push = (type: string, body: Uint8Array) => {
    parts.push((body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255);
    for (const ch of type) parts.push(ch.charCodeAt(0));
    parts.push(...body, 0, 0, 0, 0);
  };
  push('IHDR', header); push('IDAT', idat); push('IEND', new Uint8Array(0));
  return Uint8Array.from(parts);
}

describe('diffImages', () => {
  test('identical captures pass with nothing differing', () => {
    const a = canvas(40, 30, BLACK, [{ x: 5, y: 5, w: 10, h: 4, c: WHITE }]);
    const result = diffImages(a, a);
    expect(result.differing).toBe(0);
    expect(result.percent).toBe(0);
    expect(result.regions).toEqual([]);
    expect(verdict(result).pass).toBe(true);
  });

  test('small channel noise under the threshold is not a difference', () => {
    const a = canvas(10, 10, BLACK), b = canvas(10, 10, BLACK.map(v => v + 6));
    expect(diffImages(a, b).differing).toBe(0);
    expect(diffImages(a, b, { threshold: 3 }).differing).toBe(100);
  });

  test('an element moved 1 px is measured as a 1 px displacement', () => {
    const legacy = canvas(60, 40, BLACK, [{ x: 10, y: 10, w: 12, h: 6, c: WHITE }]);
    const document = canvas(60, 40, BLACK, [{ x: 11, y: 10, w: 12, h: 6, c: WHITE }]);
    const result = diffImages(legacy, document);
    // A solid box that moves differs at its leading and trailing edges; both are the same move.
    expect(result.regions.map(r => r.shift)).toEqual([{ dx: 1, dy: 0 }, { dx: 1, dy: 0 }]);
    expect(result.maxDisplacement).toBe(1);
    expect(result.changed).toBe(0);
  });

  test('a 5 px move fails the displacement rule even when few pixels differ', () => {
    const legacy = canvas(400, 300, BLACK, [{ x: 50, y: 50, w: 8, h: 3, c: WHITE }]);
    const document = canvas(400, 300, BLACK, [{ x: 50, y: 55, w: 8, h: 3, c: WHITE }]);
    const result = diffImages(legacy, document);
    expect(result.percent).toBeLessThan(1);
    expect(result.maxDisplacement).toBe(5);
    expect(verdict(result)).toEqual({ pass: false, reasons: ['an element moved 5 px (at most 2)'] });
  });

  test('a colour change is a changed region, not a move', () => {
    const legacy = canvas(50, 50, BLACK, [{ x: 10, y: 10, w: 10, h: 10, c: WHITE }]);
    const document = canvas(50, 50, BLACK, [{ x: 10, y: 10, w: 10, h: 10, c: RED }]);
    const result = diffImages(legacy, document);
    expect(result.differing).toBe(100);
    expect(result.percent).toBe(4);
    expect(result.changed).toBe(1);
    expect(result.regions[0]!.displacement).toBeNull();
    expect(result.maxDisplacement).toBe(0);
    expect(verdict(result).reasons).toEqual(['4% of pixels differ (at most 1%)']);
  });

  test('masked regions (the LIVE dot) are neither compared nor counted', () => {
    const legacy = canvas(100, 100, BLACK, [{ x: 0, y: 0, w: 10, h: 10, c: WHITE }]);
    const document = canvas(100, 100, BLACK, [{ x: 0, y: 0, w: 10, h: 10, c: RED }]);
    const result = diffImages(legacy, document, { mask: [{ x: 0, y: 0, width: 10, height: 10 }] });
    expect(result.compared).toBe(9900);
    expect(result.differing).toBe(0);
    // The diff picture tints the mask blue.
    expect(result.image.data[2]!).toBeGreaterThan(result.image.data[0]!);
  });

  test('mask review counts overlap only once and starts above five percent', () => {
    const a = canvas(100, 100, BLACK);
    const mask = [{ x: 0, y: 0, width: 5, height: 100 }, { x: 2, y: 0, width: 3, height: 100 }];
    const covered = diffImages(a, a, { mask });
    expect(maskCoverage(covered)).toBeCloseTo(5, 6);
    expect(needsMaskReview(covered)).toBe(false);
    const larger = diffImages(a, a, { mask: [...mask, { x: 5, y: 5, width: 1, height: 1 }] });
    expect(maskCoverage(larger)).toBeCloseTo(5.01, 6);
    expect(needsMaskReview(larger)).toBe(true);
  });

  test('a size mismatch counts the uncovered pixels as differing', () => {
    const result = diffImages(canvas(10, 10, BLACK), canvas(10, 12, BLACK));
    expect(result.height).toBe(12);
    expect(result.differing).toBe(20);
  });

  test('separate differences form separate regions', () => {
    const legacy = canvas(100, 100, BLACK);
    const document = canvas(100, 100, BLACK, [{ x: 5, y: 5, w: 3, h: 3, c: WHITE }, { x: 70, y: 70, w: 4, h: 2, c: WHITE }]);
    const regions = diffImages(legacy, document).regions.map(({ x, y, width, height, pixels }) => ({ x, y, width, height, pixels }));
    expect(regions).toEqual([{ x: 5, y: 5, width: 3, height: 3, pixels: 9 }, { x: 70, y: 70, width: 4, height: 2, pixels: 8 }]);
  });
});

test('reader settling skips a stable opening splash and verifies a third matching frame', async () => {
  const splash = canvas(100, 100, WHITE, [{ x: 42, y: 49, w: 16, h: 2, c: BLACK }]);
  const firstPage = canvas(100, 100, WHITE, [{ x: 10, y: 20, w: 60, h: 12, c: BLACK }]);
  const nextPage = canvas(100, 100, WHITE, [{ x: 12, y: 24, w: 60, h: 12, c: BLACK }]);
  expect(readerHasContent(splash)).toBe(false);
  expect(readerHasContent(firstPage)).toBe(true);
  const frames = [splash, splash, splash, firstPage, firstPage, nextPage, nextPage, nextPage].map(encodePng);
  const capture = await settledFrames(() => frames.shift()!, async () => {}, { reader: true, attempts: frames.length });
  expect(frames).toHaveLength(0);
  expect(capture.primary).toEqual(encodePng(nextPage));
  expect(capture.confirmed).toEqual(capture.primary);
});

describe('regions and shifts', () => {
  test('pixels within the join distance are one region', () => {
    const hit = new Uint8Array(20 * 4);
    hit[1 * 20 + 2] = 1; hit[1 * 20 + 5] = 1; hit[2 * 20 + 18] = 1;
    expect(groupRegions(hit, 20, 4, 4)).toEqual([{ x: 2, y: 1, width: 4, height: 1 }, { x: 18, y: 2, width: 1, height: 1 }]);
  });

  test('findShift prefers the shortest translation', () => {
    const legacy = canvas(30, 30, BLACK, [{ x: 10, y: 10, w: 4, h: 4, c: WHITE }]);
    const document = canvas(30, 30, BLACK, [{ x: 8, y: 11, w: 4, h: 4, c: WHITE }]);
    expect(findShift(legacy, document, { x: 8, y: 10, width: 6, height: 5 }, 4, 10)).toEqual({ dx: -2, dy: 1 });
    expect(findShift(legacy, document, { x: 8, y: 10, width: 6, height: 5 }, 1, 10)).toBeNull();
  });

  test('inMask', () => {
    expect(inMask(5, 5, [{ x: 5, y: 5, width: 1, height: 1 }])).toBe(true);
    expect(inMask(6, 5, [{ x: 5, y: 5, width: 1, height: 1 }])).toBe(false);
  });
});

describe('movingMask', () => {
  test('is empty for a still view', () => {
    const a = canvas(40, 40, BLACK, [{ x: 5, y: 5, w: 5, h: 5, c: WHITE }]);
    expect(movingMask(a, a)).toEqual([]);
  });

  test('covers what changed between two frames, padded and clipped to the frame', () => {
    const a = canvas(40, 40, BLACK, [{ x: 2, y: 20, w: 4, h: 4, c: RED }]);
    const b = canvas(40, 40, BLACK, [{ x: 2, y: 20, w: 4, h: 4, c: [120, 20, 30] }]);
    expect(movingMask(a, b, 3)).toEqual([{ x: 0, y: 17, width: 9, height: 10 }]);
  });
});
