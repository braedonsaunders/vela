import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveAssetSource } from '../../../apps/vela/src/asset-source';

const app = resolve(import.meta.dir, '../../../apps/vela/src');
// Evaluate only the generated static registry with a Metro-like require. No RN runtime
// or image decoder mock: every returned module id must name a real bundled file.
const modules: string[] = [];
const registry = readFileSync(resolve(app, 'assets.generated.ts'), 'utf8');
const assets = new Function('require', registry.replace('export const ASSETS: Record<string, number | string> =', 'return'))((path: string) => {
  expect(existsSync(resolve(app, path))).toBe(true);
  modules.push(path);
  return modules.length;
}) as Record<string, number>;
const documents = readFileSync(resolve(app, 'documents.ts'), 'utf8');
const imports = [...documents.matchAll(/import .* from '(.*fixtures\/skins\/[^']+)'/g)];

test('every picker built-in preview resolves to a bundled module with any server or offline', async () => {
  expect(imports.length).toBe(9);
  for (const [, path] of imports) {
    const imported = await import(resolve(app, path!) + '.ts');
    const doc = imported.cinematicDoc ?? imported.default;
    expect(doc.preview).toBeString();
    for (const origin of ['', 'https://jellyfin.example', 'https://plex.example']) {
      const source = resolveAssetSource(doc.preview, origin, assets);
      expect(source).toBeNumber();
      expect(modules[(source as number) - 1]).toMatch(/preview\.(jpg|svg)$|skins\/cinematic.jpg$/);
    }
  }
});

test('server-provided previews retain remote URL resolution', () => {
  expect(resolveAssetSource('/custom/preview.jpg', 'https://ether.example', assets)).toBe('https://ether.example/custom/preview.jpg');
  expect(resolveAssetSource('https://skins.example/preview.jpg', '', assets)).toBe('https://skins.example/preview.jpg');
});
