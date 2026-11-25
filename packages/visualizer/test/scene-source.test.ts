import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
