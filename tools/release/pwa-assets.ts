import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const ink = [242, 233, 214], dark = [12, 16, 21];
const sails = [[[31, 32], [58, 98], [65, 27]], [[72, 28], [99, 33], [64, 96]]];
function inside(x: number, y: number, polygon: number[][]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i], [bx, by] = polygon[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}
function crc(bytes: Uint8Array): number { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let i=0;i<8;i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; } return (n ^ 0xffffffff) >>> 0; }
function chunk(tag: string, bytes: Uint8Array): Buffer {
  const data = Buffer.concat([Buffer.from(tag), bytes]), out = Buffer.alloc(data.length + 8);
  out.writeUInt32BE(bytes.length); data.copy(out, 4); out.writeUInt32BE(crc(data), out.length - 4); return out;
}
function png(size: number): Buffer {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let coverage = 0;
    for (const dy of [.25,.75]) for (const dx of [.25,.75]) if (sails.some(p => inside((x + dx) * 128 / size, (y + dy) * 128 / size, p))) coverage++;
    const at = y * (size * 4 + 1) + 1 + x * 4, weight = coverage / 4;
    for (let c = 0; c < 3; c++) rows[at + c] = Math.round(dark[c] * (1 - weight) + ink[c] * weight);
    rows[at + 3] = 255;
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(size); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', head), chunk('IDAT', deflateSync(rows)), chunk('IEND', new Uint8Array())]);
}
export async function writePwaAssets(dist: string) {
  for (const size of [180,192,512]) await writeFile(join(dist, `vela-icon-${size}.png`), png(size));
  await writeFile(join(dist, 'vela-icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="26" fill="#0c1015"/><path d="M31 32 58 98 65 27Z M72 28 99 33 64 96Z" fill="#f2e9d6"/></svg>');
}
