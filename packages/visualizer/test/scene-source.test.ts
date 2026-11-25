import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import source from '../review.json';
import scenes from '../scenes.json';
import { metalLibrary } from '../tools/metal-library';
import { rendererParts } from '../tools/renderer-parts';

test('the release omits retired Cartography assets and packages only current picker previews', () => {
  const release = resolve(import.meta.dir, '..');
  const native = join(release, '../../modules/vela-player/ios/VisualizerAssets');
  const ids = scenes.map(scene => scene.id).sort();
  expect(ids).not.toContain('contour');
  expect(readdirSync(join(release, 'thumbnails'))).not.toContain('contour.jpg');
  const imports = readFileSync(join(release, 'thumbnails.ts'), 'utf8');
  const previews = Array.from(imports.matchAll(/require\('\.\/thumbnails\/([^']+)\.jpg'\)/g), match => match[1]);
  expect(previews.sort()).toEqual(ids);
  for (const file of [join(release, 'web/renderer.js'), join(native, 'viz-native.js'),
    join(native, 'apple-shaders.json'), join(native, 'viz-shaders.metal')]) {
    expect(readFileSync(file, 'utf8')).not.toMatch(/\b(?:worldMapTexture|hydroTexture|__mapAtlas|uHydro)\b/);
  }
});

test('the shipped scene sources reproduce the reviewed standalone page byte for byte', () => {
  const directory = join(import.meta.dir, '../scenes');
  const parts = readdirSync(directory).filter(file => /^[1-9]\d_.*\.js$/.test(file)).sort();
  const digest = createHash('sha256');
  for (const file of ['00_head.html', ...parts]) digest.update(readFileSync(join(directory, file)));
  digest.update('</script>\n</body>\n</html>\n');
  expect(digest.digest('hex')).toBe(source.pageSHA256);
  const authored = parts.flatMap(file => {
    const id = /scene\(\{\s*id:\s*'([^']+)'/.exec(readFileSync(join(directory, file), 'utf8'))?.[1];
    return id ? [id] : [];
  });
  expect(authored).toHaveLength(source.sceneCount);
  expect(new Set(authored).size).toBe(source.sceneCount);
  expect(scenes.map(scene => scene.id)).toEqual(authored.filter(id => source.includeForest || id !== 'forest'));
});

test('dropping Deep Forest excludes only its source from both renderer generators', () => {
  const directory = join(import.meta.dir, '../scenes');
  const all = rendererParts(directory, true);
  expect(all).toContain('64_forest.js');
  expect(rendererParts(directory, false)).toEqual(all.filter(name => name !== '64_forest.js'));
});

test('the packaged native bundle regenerates byte for byte and Metal covers every linked shader pair', () => {
  const root = resolve(import.meta.dir, '..');
  const assets = join(root, '../../modules/vela-player/ios/VisualizerAssets');
  const scratch = mkdtempSync(join(tmpdir(), 'vela-scene-check-'));
  const read = (directory: string, name: string) => readFileSync(join(directory, name), 'utf8');
  try {
    const build = Bun.spawnSync([process.execPath, join(root, 'tools/build.ts'), '--production', '--out', scratch]);
    if (build.exitCode !== 0) throw new Error(build.stderr.toString());
    expect(read(scratch, 'viz-native.js') === read(assets, 'viz-native.js')).toBe(true);
    expect(JSON.parse(read(scratch, 'scenes.json'))).toEqual(scenes);
    const pair = (entry: { vs: string; fs: string }) =>
      createHash('sha256').update(entry.vs).update('\0').update(entry.fs).digest('hex');
    const metal = JSON.parse(read(assets, 'apple-shaders.json'));
    expect(metal.map(pair).sort())
      .toEqual(JSON.parse(read(scratch, 'programs.json')).map(pair).sort());
    expect(metalLibrary(metal) === read(assets, 'viz-shaders.metal')).toBe(true);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
