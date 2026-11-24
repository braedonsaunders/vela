// A contact sheet of captures, for reviewing a set at a glance:
//   bun tools/parity/sheet.ts --out sheet.png --width 360 --columns 4 a.png b.png …
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decodePng, encodePng, type Image } from './png';

/** Scale an image to `width` (box filter), keeping its aspect ratio. */
export function scaleTo(image: Image, width: number): Image {
  const ratio = image.width / width, height = Math.max(1, Math.round(image.height / ratio));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = Math.floor(x * ratio), x1 = Math.max(x0 + 1, Math.floor((x + 1) * ratio));
    const y0 = Math.floor(y * ratio), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ratio));
    const sum = [0, 0, 0, 0];
    let n = 0;
    for (let sy = y0; sy < Math.min(y1, image.height); sy++) for (let sx = x0; sx < Math.min(x1, image.width); sx++) {
      const s = (sy * image.width + sx) * 4;
      for (let c = 0; c < 4; c++) sum[c]! += image.data[s + c]!;
      n++;
    }
    for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = n ? Math.round(sum[c]! / n) : 0;
  }
  return { width, height, data };
}

/** Tiles images into a grid of `columns`, each scaled to `width`, with a gap. */
export function sheet(images: Image[], width: number, columns: number, gap = 8): Image {
  const tiles = images.map(image => scaleTo(image, width));
  const rows: Image[][] = [];
  for (let n = 0; n < tiles.length; n += columns) rows.push(tiles.slice(n, n + columns));
  const rowHeights = rows.map(row => Math.max(...row.map(t => t.height)));
  const total = { width: columns * width + (columns + 1) * gap, height: rowHeights.reduce((a, b) => a + b + gap, gap) };
  const data = new Uint8Array(total.width * total.height * 4);
  for (let p = 0; p < total.width * total.height; p++) data.set([60, 60, 66, 255], p * 4);
  let top = gap;
  rows.forEach((row, r) => {
    row.forEach((tile, c) => {
      const left = gap + c * (width + gap);
      for (let y = 0; y < tile.height; y++) data.set(tile.data.subarray(y * tile.width * 4, (y + 1) * tile.width * 4), ((top + y) * total.width + left) * 4);
    });
    top += rowHeights[r]! + gap;
  });
  return { width: total.width, height: total.height, data };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, width: { type: 'string', default: '360' }, columns: { type: 'string', default: '4' } } });
  if (!values.out || !positionals.length) throw new Error('usage: sheet.ts --out sheet.png [--width 360] [--columns 4] images…');
  const images = positionals.map(file => decodePng(new Uint8Array(readFileSync(file))));
  writeFileSync(values.out, encodePng(sheet(images, Number(values.width), Number(values.columns))));
}
