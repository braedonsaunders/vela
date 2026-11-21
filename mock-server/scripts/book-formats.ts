// Dependency-free writers for the book fixtures: CRC-32, stored ZIP, PNG, a small raster canvas
// with a 5×7 bitmap font, and a minimal PDF assembler. Only node:zlib (built in) is used.
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const utf8 = (text: string) => new TextEncoder().encode(text);
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0; for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** A ZIP of stored (uncompressed) entries in the given order, UTF-8 names, fixed timestamps. */
export function zip(entries: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  const time = (12 << 11) | (0 << 5), date = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01 12:00
  for (const entry of entries) {
    const name = utf8(entry.name), data = typeof entry.data === 'string' ? utf8(entry.data) : entry.data, crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, time, true); local.setUint16(12, date, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true); central.setUint16(12, time, true); central.setUint16(14, date, true); central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true); central.setUint32(24, data.length, true); central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    locals.push(new Uint8Array(local.buffer), name, data);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const directory = concat(centrals), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, directory.length, true); end.setUint32(16, offset, true);
  return concat([...locals, directory, new Uint8Array(end.buffer)]);
}

// ---------------------------------------------------------------------------------------------
export type RGB = [number, number, number];
export const hex = (value: string): RGB => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) as RGB;
const glyphs: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  '.': [0, 0, 0, 0, 0, 12, 12], '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4], '-': [0, 0, 0, 31, 0, 0, 0],
  ',': [0, 0, 0, 0, 12, 4, 8], '&': [12, 18, 20, 8, 21, 18, 13], "'": [12, 4, 8, 0, 0, 0, 0], ' ': [0, 0, 0, 0, 0, 0, 0],
};
/** An RGB raster with a clip rectangle, filled shapes and bitmap text. */
export class Canvas {
  readonly data: Uint8Array;
  clip: [number, number, number, number];
  constructor(readonly width: number, readonly height: number, background: RGB = [255, 255, 255]) {
    this.data = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) this.data.set(background, i * 3);
    this.clip = [0, 0, width, height];
  }
  private span(y: number, x0: number, x1: number, c: RGB, alpha = 1) {
    y = Math.round(y);
    const [cx, cy, cw, ch] = this.clip;
    if (y < cy || y >= cy + ch) return;
    const a = Math.max(cx, Math.ceil(x0)), b = Math.min(cx + cw, Math.ceil(x1));
    for (let x = a; x < b; x++) {
      const i = (y * this.width + x) * 3;
      if (alpha >= 1) { this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; }
      else for (let k = 0; k < 3; k++) this.data[i + k] = Math.round(this.data[i + k]! * (1 - alpha) + c[k]! * alpha);
    }
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, alpha = 1) { for (let row = Math.round(y); row < Math.round(y + h); row++) this.span(row, x, x + w, c, alpha); }
  gradient(x: number, y: number, w: number, h: number, top: RGB, bottom: RGB) {
    for (let row = Math.round(y); row < Math.round(y + h); row++) {
      const t = (row - y) / Math.max(1, h);
      this.span(row, x, x + w, top.map((v, k) => Math.round(v + (bottom[k]! - v) * t)) as RGB);
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, alpha = 1) {
    for (let row = Math.ceil(cy - ry); row <= Math.floor(cy + ry); row++) {
      const dy = (row - cy) / ry, half = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
      this.span(row, cx - half, cx + half, c, alpha);
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB, alpha = 1) { this.ellipse(cx, cy, r, r, c, alpha); }
  /** Even-odd scanline fill of a polygon. */
  polygon(points: [number, number][], c: RGB, alpha = 1) {
    const ys = points.map(p => p[1]);
    for (let row = Math.ceil(Math.min(...ys)); row <= Math.floor(Math.max(...ys)); row++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i]!, [x2, y2] = points[(i + 1) % points.length]!;
        if ((y1 <= row && y2 > row) || (y2 <= row && y1 > row)) xs.push(x1 + (row - y1) / (y2 - y1) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) this.span(row, xs[i]!, xs[i + 1]!, c, alpha);
    }
  }
  line(x1: number, y1: number, x2: number, y2: number, width: number, c: RGB, alpha = 1) {
    const length = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / length * width / 2, ny = (x2 - x1) / length * width / 2;
    this.polygon([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]], c, alpha);
    this.circle(x1, y1, width / 2, c, alpha); this.circle(x2, y2, width / 2, c, alpha);
  }
  frame(x: number, y: number, w: number, h: number, t: number, c: RGB) { this.rect(x, y, w, t, c); this.rect(x, y + h - t, w, t, c); this.rect(x, y, t, h, c); this.rect(x + w - t, y, t, h, c); }
  textWidth(text: string, scale: number) { return text.length * 6 * scale - scale; }
  text(text: string, x: number, y: number, scale: number, c: RGB) {
    [...text.toUpperCase()].forEach((char, n) => (glyphs[char] ?? glyphs['?']!).forEach((bits, row) => {
      for (let col = 0; col < 5; col++) if (bits & (16 >> col)) this.rect(x + (n * 6 + col) * scale, y + row * scale, scale, scale, c);
    }));
  }
  /** Box-filter downsample by an integer factor (supersampled anti-aliasing). */
  downsample(factor: number): Canvas {
    const out = new Canvas(Math.floor(this.width / factor), Math.floor(this.height / factor));
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) for (let k = 0; k < 3; k++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) sum += this.data[((y * factor + dy) * this.width + x * factor + dx) * 3 + k]!;
      out.data[(y * out.width + x) * 3 + k] = Math.round(sum / (factor * factor));
    }
    return out;
  }
  png(): Uint8Array {
    const raw = new Uint8Array((this.width * 3 + 1) * this.height);
    for (let y = 0; y < this.height; y++) raw.set(this.data.subarray(y * this.width * 3, (y + 1) * this.width * 3), y * (this.width * 3 + 1) + 1);
    const chunk = (type: string, body: Uint8Array) => {
      const head = new DataView(new ArrayBuffer(8)); head.setUint32(0, body.length); const name = utf8(type); new Uint8Array(head.buffer).set(name, 4);
      const tail = new DataView(new ArrayBuffer(4)); tail.setUint32(0, crc32(body, crc32(name)));
      return concat([new Uint8Array(head.buffer), body, new Uint8Array(tail.buffer)]);
    };
    const ihdr = new DataView(new ArrayBuffer(13)); ihdr.setUint32(0, this.width); ihdr.setUint32(4, this.height); ihdr.setUint8(8, 8); ihdr.setUint8(9, 2);
    return concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', new Uint8Array(ihdr.buffer)), chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))), chunk('IEND', new Uint8Array())]);
  }
}

// ---------------------------------------------------------------------------------------------
/** A PDF from page content streams (ASCII), standard Type 1 fonts F1 Helvetica, F2 Helvetica-Bold, F3 Times-Italic. */
export function pdf(pages: string[], info: { title: string; author: string }, size: [number, number] = [612, 792]): Uint8Array {
  const literal = (text: string) => `(${text.replace(/[\\()]/g, m => `\\${m}`)})`;
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalog = add(''), pagesId = add('');
  const fonts = ['Helvetica', 'Helvetica-Bold', 'Times-Italic'].map(name => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`));
  const kids = pages.map(content => {
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${size[0]} ${size[1]}] /Resources << /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R >> >> /Contents ${stream} 0 R >>`);
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(id => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const infoId = add(`<< /Title ${literal(info.title)} /Author ${literal(info.author)} /Producer (Vela mock fixtures) /CreationDate (D:20260101120000Z) >>`);
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
/** PDF text operators: a literal string escaped for a content stream. */
export const pdfText = (text: string) => `(${text.replace(/[\\()]/g, m => `\\${m}`)})`;
