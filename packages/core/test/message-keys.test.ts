// Every literal message key the app and skins ask for exists in the English catalogue, so no
// raw key ("ui.playFromBeginning") ever reaches the screen.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '../../..');
const catalogue = JSON.parse(readFileSync(join(root, 'packages/core/src/i18n/strings/en.json'), 'utf8')) as Record<string, string>;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'test' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

test('every msg() and {t:} key used in source exists in en.json', () => {
  const files = ['packages/skin/src', 'packages/core/src', 'apps/vela/src', 'apps/vela/app', 'packages/protocol/fixtures/skins']
    .flatMap(dir => sources(join(root, dir)));
  const missing = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bmsg\(\s*'([a-zA-Z][\w.]+)'/g)) if (!(match[1]! in catalogue)) missing.add(`${match[1]} (${file.slice(root.length + 1)})`);
    for (const match of text.matchAll(/\{t:([a-zA-Z][\w.]+)\}/g)) if (!(match[1]! in catalogue)) missing.add(`${match[1]} (${file.slice(root.length + 1)})`);
  }
  expect([...missing].sort()).toEqual([]);
});
