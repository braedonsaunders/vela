// A reproducible .tar.gz of source files: sorted paths, fixed modes, owners and times, so the same
// sources always give the same bytes (and the payload the same digest).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BLOCK = 512;

function octal(value: number, width: number) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

/** One ustar header; names over 100 bytes go to the prefix field, split at a slash. */
function header(name: string, size: number): Uint8Array {
  const block = Buffer.alloc(BLOCK);
  let prefix = '';
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 155);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
    if (cut < 0 || Buffer.byteLength(base) > 100) throw new Error(`Path too long for tar: ${name}`);
  }
  block.write(base, 0);
  block.write(octal(0o644, 8), 100);
  block.write(octal(0, 8), 108);
  block.write(octal(0, 8), 116);
  block.write(octal(size, 12), 124);
  block.write(octal(0, 12), 136);
  block.write('        ', 148);
  block.write('0', 156);
  block.write('ustar\0', 257);
  block.write('00', 263);
  block.write(prefix, 345);
  let checksum = 0;
  for (const byte of block) checksum += byte;
  block.write(octal(checksum, 7), 148);
  return block;
}

/** `files` are paths relative to `root`; each is stored under `prefix/`. */
export async function reproducibleTarGz(root: string, files: string[], prefix: string): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (const file of [...files].sort()) {
    const bytes = await readFile(join(root, file));
    parts.push(header(`${prefix}/${file}`, bytes.length), bytes);
    const padding = (BLOCK - (bytes.length % BLOCK)) % BLOCK;
    if (padding) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  const gzip = gzipSync(Buffer.concat(parts), { level: 9 });
  // The header's OS byte differs between zlib builds; "unknown" keeps it the same everywhere.
  gzip[9] = 255;
  return gzip;
}
