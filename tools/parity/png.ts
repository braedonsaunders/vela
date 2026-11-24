// Minimal PNG reading and writing for the parity harness: 8-bit RGB/RGBA (and grey, grey+alpha,
// palette), non-interlaced, which is what browsers and simulators write. No dependency beyond zlib.
import { deflateSync, inflateSync } from 'node:zlib';

export interface Image { width: number; height: number; /** RGBA, row-major. */ data: Uint8Array }

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

export function decodePng(bytes: Uint8Array): Image {
  for (let n = 0; n < 8; n++) if (bytes[n] !== SIGNATURE[n]) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  let palette: Uint8Array | undefined, transparency: Uint8Array | undefined;
  const chunks: Uint8Array[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at), type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8); height = view.getUint32(at + 12);
      depth = body[8]!; colour = body[9]!; interlace = body[12]!;
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') chunks.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8) throw new Error(`PNG bit depth ${depth} is not supported`);
  if (interlace) throw new Error('interlaced PNG is not supported');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colour];
  if (!channels) throw new Error(`PNG colour type ${colour} is not supported`);
  const raw = inflateSync(concat(chunks));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    unfilter(filter, line, pixels, y, stride, channels);
  }
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const s = p * channels, d = p * 4;
    if (colour === 6) { data[d] = pixels[s]!; data[d + 1] = pixels[s + 1]!; data[d + 2] = pixels[s + 2]!; data[d + 3] = pixels[s + 3]!; }
    else if (colour === 2) { data[d] = pixels[s]!; data[d + 1] = pixels[s + 1]!; data[d + 2] = pixels[s + 2]!; data[d + 3] = 255; }
    else if (colour === 0) { data[d] = data[d + 1] = data[d + 2] = pixels[s]!; data[d + 3] = 255; }
    else if (colour === 4) { data[d] = data[d + 1] = data[d + 2] = pixels[s]!; data[d + 3] = pixels[s + 1]!; }
    else {
      const i = pixels[s]!;
      data[d] = palette?.[i * 3] ?? 0; data[d + 1] = palette?.[i * 3 + 1] ?? 0; data[d + 2] = palette?.[i * 3 + 2] ?? 0;
      data[d + 3] = transparency?.[i] ?? 255;
    }
  }
  return { width, height, data };
}

function unfilter(filter: number, line: Uint8Array, out: Uint8Array, y: number, stride: number, bpp: number): void {
  const row = y * stride, prev = row - stride;
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? out[row + x - bpp]! : 0;
    const b = y > 0 ? out[prev + x]! : 0;
    const c = x >= bpp && y > 0 ? out[prev + x - bpp]! : 0;
    const value = line[x]!;
    let predicted = 0;
    if (filter === 1) predicted = a;
    else if (filter === 2) predicted = b;
    else if (filter === 3) predicted = (a + b) >> 1;
    else if (filter === 4) predicted = paeth(a, b, c);
    else if (filter !== 0) throw new Error(`PNG filter ${filter} is not supported`);
    out[row + x] = (value + predicted) & 255;
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function encodePng(image: Image): Uint8Array {
  const { width, height, data } = image;
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  header[8] = 8; header[9] = 6;
  return concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))]);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let n = 0; n < 4; n++) out[4 + n] = type.charCodeAt(n);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
