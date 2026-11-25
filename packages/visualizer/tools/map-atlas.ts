import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');

// Embed the atlas only for bundles that actually include the map. Omit long empty
// spans so standalone Hermes/JSC bundles can load it without an image decoder.
export function mapAtlasSource() {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'assets/contour-labels.json'), 'utf8'));
  const pixels = fs.readFileSync(path.join(root, 'assets/contour-labels.r8'));
  if (pixels.length !== metadata.width * metadata.height ||
      new Bun.CryptoHasher('sha256').update(pixels).digest('hex') !== metadata.sha256) {
    throw new Error('Map atlas does not match its manifest');
  }
  const spans: [number, string][] = [];
  let start = 0;
  for (let i = 0; i < pixels.length;) {
    if (pixels[i] !== 0) { i++; continue; }
    const end = i;
    while (i < pixels.length && pixels[i] === 0) i++;
    if (i - end < 8) continue;
    if (end > start) spans.push([start, pixels.subarray(start, end).toString('hex')]);
    start = i;
  }
  if (start < pixels.length) spans.push([start, pixels.subarray(start).toString('hex')]);
  return 'const __mapAtlas = ' + JSON.stringify({ ...metadata, spans }) + ';\n' +
    fs.readFileSync(path.join(root, 'runtime/map-atlas.js'), 'utf8');
}
