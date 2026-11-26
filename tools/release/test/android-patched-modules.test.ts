// A bun patch on an Expo module's Android source only reaches the APK when that module is
// compiled from source; otherwise Gradle links the module's prebuilt AAR and the patch is lost.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '../../..');
const app = JSON.parse(readFileSync(join(root, 'apps/vela/package.json'), 'utf8'));
const fromSource: string[] = app.expo?.autolinking?.android?.buildFromSource ?? [];

function patchedAndroidModules(): string[] {
  const names: string[] = [];
  for (const file of readdirSync(join(root, 'patches'))) {
    const name = file.replace(/@[^@]+\.patch$/, '').replace(/^(@[^+]+)\+/, '$1/');
    const patch = readFileSync(join(root, 'patches', file), 'utf8');
    if (name.startsWith('expo-') && /^diff --git a\/android\//m.test(patch)) names.push(name);
  }
  return names;
}

describe('patched Expo Android modules', () => {
  test('expo-image is patched for off-thread SVG drawing', () => {
    expect(patchedAndroidModules()).toContain('expo-image');
  });
  test('every Expo module with an Android patch is built from source', () => {
    for (const name of patchedAndroidModules()) expect(fromSource).toContain(name);
  });
});
