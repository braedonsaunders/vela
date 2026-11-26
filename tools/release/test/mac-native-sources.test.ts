// The Mac app compiles a fixed list of the Apple player's Swift files (apps/vela-desktop/mac/build.mjs).
// A listed file that starts using a type from an unlisted file builds for iOS and tvOS but breaks the Mac
// release, which no CI job compiles; catch that here.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '../../..');
const ios = join(root, 'modules/vela-player/ios');
const build = readFileSync(join(root, 'apps/vela-desktop/mac/build.mjs'), 'utf8');
const list = build.match(/for \(const name of \[([^\]]+)\]\)\s*\n\s*cpSync\(join\(ios/)?.[1] ?? '';
const listed = new Set([...list.matchAll(/'(\w+)'/g)].map(m => m[1]!));
const all = readdirSync(ios).filter(f => f.endsWith('.swift')).map(f => f.slice(0, -'.swift'.length));
const code = (name: string) => readFileSync(join(ios, `${name}.swift`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('the Mac build list names existing Swift files', () => {
  expect(listed.size).toBeGreaterThan(10);
  for (const name of listed) expect(all).toContain(name);
});

test('every Swift file the Mac build compiles finds the player files it uses', () => {
  const missing: string[] = [];
  for (const name of listed) {
    const source = code(name);
    for (const other of all) if (!listed.has(other) && new RegExp(`\\b${other}\\b`).test(source)) missing.push(`${name} uses ${other}`);
  }
  expect(missing).toEqual([]);
});
