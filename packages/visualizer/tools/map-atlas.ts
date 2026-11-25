import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { packTexture, unpackTexture } from './texture-bytes';

const root = path.resolve(import.meta.dir, '..');
const assets = path.join(root, 'assets');

// The named-city scene keeps its data in a top-level block. Match the complete
// name sequence so a stale raster cannot silently put the wrong name on a town.
export function mapAtlasVariant(sceneSource: string): string {
  const end = sceneSource.lastIndexOf('}');
  const capture = sceneSource.slice(0, end) +
    'return typeof CITIES === "undefined" ? MAP_NAMES : CITIES.map(city => city[0]);}';
  const labels = new Function('VS', 'FSH', 'scene', capture)('', '', () => {});
  const dirs = ['', ...fs.readdirSync(assets, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name)];
  for (const dir of dirs) {
    const manifest = path.join(assets, dir, 'contour-labels.json');
    if (!fs.existsSync(manifest)) continue;
    if (JSON.stringify(JSON.parse(fs.readFileSync(manifest, 'utf8')).labels) === JSON.stringify(labels)) return dir;
  }
  throw new Error('No map-label atlas for this city set');
}

export function mapAtlasSource(variant = '') {
  const metadata = JSON.parse(fs.readFileSync(path.join(assets, variant, 'contour-labels.json'), 'utf8'));
  const raster = path.join(assets, variant, 'contour-labels.r8');
  const pixels = fs.existsSync(raster) ? fs.readFileSync(raster) : gunzipSync(fs.readFileSync(raster + '.gz'));
  if (pixels.length !== metadata.width * metadata.height ||
      new Bun.CryptoHasher('sha256').update(pixels).digest('hex') !== metadata.sha256) {
    throw new Error('Map atlas does not match its manifest');
  }
  return 'const __mapAtlas = ' + JSON.stringify({ ...metadata, packed: packTexture(pixels) }) + ';\n' +
    'const __unpackAtlas = ' + unpackTexture.toString() + ';\n' +
    fs.readFileSync(path.join(root, 'runtime/map-atlas.js'), 'utf8');
}
