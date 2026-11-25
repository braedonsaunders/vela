import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import source from '../review.json';
import scenes from '../scenes.json';

test('the shipped scene sources reproduce the reviewed standalone page byte for byte', () => {
  const directory = join(import.meta.dir, '../scenes');
  const parts = readdirSync(directory).filter(file => /^[1-9]\d_.*\.js$/.test(file)).sort();
  const digest = createHash('sha256');
  for (const file of ['00_head.html', ...parts]) digest.update(readFileSync(join(directory, file)));
  digest.update('</script>\n</body>\n</html>\n');
  expect(digest.digest('hex')).toBe(source.pageSHA256);
  expect(new Set(scenes.map(scene => scene.id)).size).toBe(source.sceneCount);
  expect(scenes).toHaveLength(source.sceneCount);
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
    expect(JSON.parse(read(assets, 'apple-shaders.json')).map(pair).sort())
      .toEqual(JSON.parse(read(scratch, 'programs.json')).map(pair).sort());
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
