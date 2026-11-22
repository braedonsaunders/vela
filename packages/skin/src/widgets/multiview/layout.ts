// Where multiview's tiles stand. Every tile's picture is a full-screen view moved into its slot by a
// transform (translate, then scale about the centre), so a layout change or full screen is only a
// transform animation, never a resize of a playing video surface.

export type MultiviewLayout = 'single' | 'split' | 'grid' | 'feature';

export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }
/** A full-screen view's transform into a rect: translate then scale about the view's centre. */
export interface Placement { translateX: number; translateY: number; scale: number }

export const MAX_TILES = 4;
const ASPECT = 16 / 9;

/** The layouts a number of tiles can take, the first being the default. */
export function layoutsFor(count: number): MultiviewLayout[] {
  if (count <= 1) return ['single'];
  if (count === 2) return ['split', 'feature'];
  return ['grid', 'feature'];
}

/** Keeps the viewer's choice while the tile count allows it, else the count's default. */
export function settleLayout(chosen: MultiviewLayout | null, count: number): MultiviewLayout {
  const allowed = layoutsFor(count);
  return chosen && allowed.includes(chosen) ? chosen : allowed[0]!;
}

/** The largest 16:9 rect inside a box, centred in it. */
function fit(x: number, y: number, width: number, height: number): Rect {
  const w = Math.max(0, Math.min(width, height * ASPECT));
  const h = w / ASPECT;
  return { x: x + (width - w) / 2, y: y + (height - h) / 2, width: w, height: h };
}

/** Each slot's rect, in display order, for `count` tiles on a screen of `size` with `gap` between and
 * around tiles. `feature` is one large tile with the rest stacked beside it (1 big + up to 3 small).
 * `caption` is the height of what is on each tile, drawn under the tiles of `split` and `feature`:
 * the tiles and their captions stand together in the middle of the screen. */
export function slotRects(layout: MultiviewLayout, count: number, size: Size, gap: number, caption = 0): Rect[] {
  const { width: W, height: H } = size;
  const n = Math.max(0, Math.min(MAX_TILES, count));
  if (n === 0) return [];
  if (layout === 'single' || n === 1) return [{ x: 0, y: 0, width: W, height: H }];
  if (H > W) return portraitRects(layout, n, size, gap);
  if (layout === 'split') {
    const w = (W - gap * 3) / 2;
    const below = caption > 0 ? caption + gap : 0;
    const h = Math.min(w / ASPECT, H - gap * 2 - below);
    const top = Math.max(gap, (H - h - below) / 2);
    return [0, 1].slice(0, n).map(i => fit(gap + i * (w + gap), top, w, h));
  }
  if (layout === 'grid') {
    const w = (W - gap * 3) / 2;
    const h = (H - gap * 3) / 2;
    return Array.from({ length: n }, (_, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      // Three tiles: the third sits centred on the bottom row.
      const x = n === 3 && i === 2 ? (W - w) / 2 : gap + col * (w + gap);
      return fit(x, gap + row * (h + gap), w, h);
    });
  }
  const { big, side } = featureFrame(size, gap, caption);
  const sides = Array.from({ length: n - 1 }, (_, i) => side[i]!);
  return [big, ...sides];
}

/** A phone held upright: tiles stack down the screen (side by side and the grid alike); one big
 * keeps the big tile on top across the width with the others in a row under it. */
function portraitRects(layout: MultiviewLayout, n: number, size: Size, gap: number): Rect[] {
  const { width: W, height: H } = size;
  if (layout === 'feature') {
    const bigW = W - 2 * gap;
    const smallW = (W - 4 * gap) / 3;
    const total = bigW / ASPECT + gap + smallW / ASPECT;
    const top = Math.max(gap, (H - total) / 2);
    const big = { x: gap, y: top, width: bigW, height: bigW / ASPECT };
    const rowTop = top + big.height + gap;
    const left = (W - ((n - 1) * smallW + (n - 2) * gap)) / 2;
    return [big, ...Array.from({ length: n - 1 }, (_, i) => ({ x: left + i * (smallW + gap), y: rowTop, width: smallW, height: smallW / ASPECT }))];
  }
  const h = Math.min((W - 2 * gap) / ASPECT, (H - (n + 1) * gap) / n);
  const w = h * ASPECT;
  const top = (H - (n * h + (n - 1) * gap)) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: (W - w) / 2, y: top + i * (h + gap), width: w, height: h }));
}

/** One big tile and a column of three beside it, the same height, at the top; the band below holds
 * what is on each tile. The big tile keeps its size whether one, two or three stand beside it. */
function featureFrame(size: Size, gap: number, caption: number): { big: Rect; side: Rect[]; band: Rect } {
  const { width: W, height: H } = size;
  const below = caption > 0 ? caption + gap : 0;
  // Heights match when the big tile is three small ones and their two gaps tall.
  let small = (W - 3 * gap - (2 * gap) * ASPECT) / 4;
  let bigW = 3 * small + 2 * gap * ASPECT;
  const tallest = H - 2 * gap - below;
  if (bigW / ASPECT > tallest) {
    const scale = tallest / (bigW / ASPECT);
    small *= scale;
    bigW *= scale;
  }
  const bigH = bigW / ASPECT, smallH = small / ASPECT;
  const left = (W - (bigW + gap + small)) / 2;
  const top = Math.max(gap, (H - bigH - below) / 2);
  const big = { x: left, y: top, width: bigW, height: bigH };
  const side = [0, 1, 2].map(i => ({ x: left + bigW + gap, y: top + i * (smallH + gap), width: small, height: smallH }));
  return { big, side, band: { x: left, y: top + bigH + gap, width: bigW + gap + small, height: caption } };
}

/** The band under the feature layout's tiles, `caption` tall. */
export function featureBand(size: Size, gap: number, caption: number): Rect {
  return featureFrame(size, gap, caption).band;
}

/** The transform that puts a full-screen view of `size` onto `rect`. */
export function placement(rect: Rect, size: Size): Placement {
  if (size.width <= 0 || size.height <= 0) return { translateX: 0, translateY: 0, scale: 1 };
  return {
    translateX: rect.x + rect.width / 2 - size.width / 2,
    translateY: rect.y + rect.height / 2 - size.height / 2,
    scale: rect.width / size.width,
  };
}

/** Stream heights a tile asks for: the smallest that covers its on-screen height in device pixels. */
export const HEIGHT_LADDER = [480, 720, 1080, 2160] as const;
export function ladderHeight(pixels: number): number {
  return HEIGHT_LADDER.find(step => step >= Math.ceil(pixels - 0.5)) ?? HEIGHT_LADDER[HEIGHT_LADDER.length - 1];
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/** The slot a direction moves to from `from`: the nearest rect whose centre lies that way, preferring
 * the one most in line. -1 when there is none (the edge). */
export function neighbour(rects: Rect[], from: number, direction: Direction): number {
  const origin = rects[from];
  if (!origin) return -1;
  const cx = origin.x + origin.width / 2, cy = origin.y + origin.height / 2;
  let best = -1, bestScore = Infinity;
  rects.forEach((rect, index) => {
    if (index === from) return;
    const dx = rect.x + rect.width / 2 - cx, dy = rect.y + rect.height / 2 - cy;
    const along = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 1) return;
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = index; }
  });
  return best;
}
