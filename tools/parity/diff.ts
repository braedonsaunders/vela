// Pixel parity between a legacy capture and a document capture of the same view.
//
// The owner's rule: at most 1% of pixels differ outside the moving regions (masked), nothing moves
// by more than 2 px, and every remaining difference is reviewed. `diffImages` counts differing
// pixels outside the mask, groups them into regions, and for each region finds the smallest
// translation of the legacy pixels that explains it: that is how far the element moved. A region
// no translation explains is a change of content (a colour, a glyph), reported for review.
import type { Image } from './png';

export interface Rect { x: number; y: number; width: number; height: number }

export interface DiffOptions {
  /** A pixel differs when any channel differs by more than this (0..255). */
  threshold?: number;
  /** Regions left out of the comparison: things that move by design (the LIVE dot, the graph's end pulse). */
  mask?: Rect[];
  /** The largest translation searched for, in pixels. */
  maxShift?: number;
  /** Differing pixels closer than this belong to one region (one glyph run, one card). */
  join?: number;
}

export interface Region extends Rect {
  /** Differing pixels inside it. */
  pixels: number;
  /** The translation (legacy to document) that explains it, or null when none within maxShift does. */
  shift: { dx: number; dy: number } | null;
  /** |shift| in pixels, or null. */
  displacement: number | null;
}

export interface DiffResult {
  width: number; height: number;
  /** Pixels compared (outside the mask). */
  compared: number;
  differing: number;
  /** differing / compared, as a percentage. */
  percent: number;
  regions: Region[];
  /** The largest displacement among regions a translation explains (0 when none moved). */
  maxDisplacement: number;
  /** Regions no translation explains: content changes for review. */
  changed: number;
  /** Legacy in grey, differing pixels red, masked areas blue. */
  image: Image;
}

export interface Verdict { pass: boolean; reasons: string[] }

export const RULE = { maxPercent: 1, maxDisplacement: 2 } as const;
export const MAX_MASK_PERCENT = 5;

/** Uses the union of all masks because overlapping rectangles exclude a pixel only once. */
export function maskCoverage({ width, height, compared }: Pick<DiffResult, 'width' | 'height' | 'compared'>): number {
  return width && height ? (1 - compared / (width * height)) * 100 : 0;
}

export function needsMaskReview(result: Pick<DiffResult, 'width' | 'height' | 'compared'>): boolean {
  return result.width * result.height - result.compared > result.width * result.height * MAX_MASK_PERCENT / 100;
}

export function inMask(x: number, y: number, mask: readonly Rect[]): boolean {
  for (const r of mask) if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return true;
  return false;
}

/** Whether the pixel at index p differs between the two (RGBA) buffers by more than threshold. */
function differs(a: Uint8Array, b: Uint8Array, p: number, q: number, threshold: number): boolean {
  return Math.abs(a[p]! - b[q]!) > threshold || Math.abs(a[p + 1]! - b[q + 1]!) > threshold
    || Math.abs(a[p + 2]! - b[q + 2]!) > threshold || Math.abs(a[p + 3]! - b[q + 3]!) > threshold;
}

export function diffImages(legacy: Image, document: Image, options: DiffOptions = {}): DiffResult {
  const threshold = options.threshold ?? 10, mask = options.mask ?? [], maxShift = options.maxShift ?? 8, join = Math.max(1, options.join ?? 4);
  // Compare over the larger frame: pixels present in only one image differ.
  const width = Math.max(legacy.width, document.width), height = Math.max(legacy.height, document.height);
  const hit = new Uint8Array(width * height);
  let compared = 0, differing = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inMask(x, y, mask)) continue;
      compared++;
      const inA = x < legacy.width && y < legacy.height, inB = x < document.width && y < document.height;
      const different = !inA || !inB || differs(legacy.data, document.data, (y * legacy.width + x) * 4, (y * document.width + x) * 4, threshold);
      if (different) { hit[y * width + x] = 1; differing++; }
    }
  }
  const regions = groupRegions(hit, width, height, join).map(rect => {
    let pixels = 0;
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) pixels += hit[y * width + x]!;
    const shift = findShift(legacy, document, rect, maxShift, threshold, mask);
    return { ...rect, pixels, shift, displacement: shift ? round(Math.hypot(shift.dx, shift.dy)) : null };
  });
  const moved = regions.filter(r => r.displacement !== null).map(r => r.displacement!);
  return {
    width, height, compared, differing,
    percent: compared ? round((differing / compared) * 100, 3) : 0,
    regions,
    maxDisplacement: moved.length ? Math.max(...moved) : 0,
    changed: regions.filter(r => r.shift === null).length,
    image: diffPicture(legacy, hit, width, height, mask),
  };
}

export function verdict(result: Pick<DiffResult, 'percent' | 'maxDisplacement'>, rule: { maxPercent: number; maxDisplacement: number } = RULE): Verdict {
  const reasons: string[] = [];
  if (result.percent > rule.maxPercent) reasons.push(`${result.percent}% of pixels differ (at most ${rule.maxPercent}%)`);
  if (result.maxDisplacement > rule.maxDisplacement) reasons.push(`an element moved ${result.maxDisplacement} px (at most ${rule.maxDisplacement})`);
  return { pass: reasons.length === 0, reasons };
}

/** Bounding boxes of clusters of hit pixels, clustering on a grid of `join`-sized cells. */
export function groupRegions(hit: Uint8Array, width: number, height: number, join: number): Rect[] {
  const cols = Math.ceil(width / join), rows = Math.ceil(height / join);
  const cell = new Int32Array(cols * rows).fill(-1);
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const marked = new Uint8Array(cols * rows);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (hit[y * width + x]) marked[Math.floor(y / join) * cols + Math.floor(x / join)] = 1;
  const stack: number[] = [];
  for (let start = 0; start < marked.length; start++) {
    if (!marked[start] || cell[start] !== -1) continue;
    const id = boxes.length;
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    boxes.push(box);
    cell[start] = id; stack.push(start);
    while (stack.length) {
      const c = stack.pop()!, cx = c % cols, cy = Math.floor(c / cols);
      box.x0 = Math.min(box.x0, cx); box.y0 = Math.min(box.y0, cy); box.x1 = Math.max(box.x1, cx); box.y1 = Math.max(box.y1, cy);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = ny * cols + nx;
        if (marked[n] && cell[n] === -1) { cell[n] = id; stack.push(n); }
      }
    }
  }
  // Tighten each cell box to its hit pixels.
  return boxes.map(b => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = b.y0 * join; y < Math.min(height, (b.y1 + 1) * join); y++) for (let x = b.x0 * join; x < Math.min(width, (b.x1 + 1) * join); x++) {
      if (!hit[y * width + x]) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  });
}

/** The smallest translation (by length) under which the region of `document` matches `legacy`:
 * at most 1% of its pixels (and of its differing pixels) still differ. Null when none does. */
export function findShift(legacy: Image, document: Image, rect: Rect, maxShift: number, threshold: number, mask: readonly Rect[] = []): { dx: number; dy: number } | null {
  const shifts: { dx: number; dy: number; length: number }[] = [];
  for (let dy = -maxShift; dy <= maxShift; dy++) for (let dx = -maxShift; dx <= maxShift; dx++) shifts.push({ dx, dy, length: Math.hypot(dx, dy) });
  shifts.sort((a, b) => a.length - b.length);
  const area = rect.width * rect.height;
  const step = area > 400_000 ? 3 : area > 100_000 ? 2 : 1;
  const allowed = Math.max(1, Math.floor((area / (step * step)) * 0.01));
  for (const { dx, dy } of shifts) {
    let misses = 0;
    for (let y = rect.y; y < rect.y + rect.height && misses <= allowed; y += step) {
      for (let x = rect.x; x < rect.x + rect.width; x += step) {
        if (inMask(x, y, mask)) continue;
        const lx = x - dx, ly = y - dy;
        if (x >= document.width || y >= document.height || lx < 0 || ly < 0 || lx >= legacy.width || ly >= legacy.height
          || differs(document.data, legacy.data, (y * document.width + x) * 4, (ly * legacy.width + lx) * 4, threshold)) {
          if (++misses > allowed) break;
        }
      }
    }
    if (misses <= allowed) return dx === 0 && dy === 0 ? null : { dx, dy };
  }
  return null;
}

function diffPicture(legacy: Image, hit: Uint8Array, width: number, height: number, mask: readonly Rect[]): Image {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const d = (y * width + x) * 4;
    if (hit[y * width + x]) { data[d] = 255; data[d + 1] = 32; data[d + 2] = 48; data[d + 3] = 255; continue; }
    const inside = x < legacy.width && y < legacy.height;
    const s = (y * legacy.width + x) * 4;
    const grey = inside ? Math.round((legacy.data[s]! * 0.3 + legacy.data[s + 1]! * 0.59 + legacy.data[s + 2]! * 0.11) * 0.45) : 0;
    const masked = inMask(x, y, mask);
    data[d] = grey; data[d + 1] = grey; data[d + 2] = masked ? Math.min(255, grey + 120) : grey; data[d + 3] = 255;
  }
  return { width, height, data };
}

const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

/** The regions that move by themselves in a view (the LIVE dot's pulse, the graph's end pulse):
 * what differs between two frames of the same capture taken a moment apart, padded. */
export function movingMask(first: Image, second: Image, pad = 6, threshold = 10): Rect[] {
  const width = Math.min(first.width, second.width), height = Math.min(first.height, second.height);
  const hit = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (differs(first.data, second.data, (y * first.width + x) * 4, (y * second.width + x) * 4, threshold)) hit[y * width + x] = 1;
  }
  return groupRegions(hit, width, height, 8).map(r => {
    const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
    return { x, y, width: Math.min(width, r.x + r.width + pad) - x, height: Math.min(height, r.y + r.height + pad) - y };
  });
}
