import { expect, test } from 'bun:test';
import { appearanceAsset, chosenSkin, installedDocument } from '../src/installed';
import type { AppearanceModel } from '../../core/src/appearance';
const origin = 'https://ether.test';
test('appearance assets stay within the selected origin and allowlisted tree', () => {
  expect(appearanceAsset('/vela/v0/appearance/packs/a/1/logo.svg', origin)).toStartWith(origin);
  for (const url of ['https://other.test/vela/v0/appearance/skins/a/1/a.png', '/admin/a.png', '/vela/v0/appearance/skins/../../a.png', '/vela/v0/appearance/skins/a/x.js', '/vela/v0/appearance/skins/a/x.svg?token=x']) expect(() => appearanceAsset(url, origin)).toThrow();
});
test('viewer choice wins over default; force wins over viewer; removed choice falls back', () => {
  const a = { defaultSkinId: 'owner', force: false } as AppearanceModel;
  expect(chosenSkin(['builtin', 'owner'], '', a)).toBe('owner');
  expect(chosenSkin(['builtin', 'owner'], 'builtin', a)).toBe('builtin');
  expect(chosenSkin(['builtin', 'owner'], 'builtin', { ...a, force: true })).toBe('owner');
  expect(chosenSkin(['builtin'], 'removed', a)).toBe('builtin');
});
test('invalid documents and foreign static images are rejected', () => {
  expect(() => installedDocument({ schema: 2 }, origin)).toThrow();
  expect(() => installedDocument({ schema: 1, routes: { home: { type: 'image', src: 'https://bad.test/logo.png' } } }, origin)).toThrow();
});

test('valid minimal document resolves on phone desktop and TV; nonportable styles fail', () => {
  const doc = { schema: 1, renderer: 16, id: 'owner', name: 'Owner', version: '1.0.0', swatches: ['#123456'], slots: { home: { type: 'box', style: { background: '#123456' }, children: [] } } };
  expect(installedDocument(doc, origin).id).toBe('owner');
  expect(() => installedDocument({ ...doc, renderer: 999 }, origin)).toThrow();
  expect(() => installedDocument({ ...doc, slots: { home: { type: 'box', style: { position: 'fixed' }, children: [] } } }, origin)).toThrow();
});

test('packs layer supported palette roles on the engine without unknown ui keys', async () => {
  const { appearanceModel } = await import('../../core/src/appearance');
  const { packDocument } = await import('../src/installed');
  const { cinematicDoc } = await import('../../protocol/fixtures/skins/cinematic');
  const { resolveDocument } = await import('../src/resolve');
  const model = appearanceModel({ revision: 1, defaultSkinId: 'owner', defaultEngineId: 'cinematic', force: false, packs: [{ schema: 1, id: 'owner', version: '1', name: 'Owner', engine: 'cinematic', palette: { page: '#123456', tide: '#123456' }, images: { wordmark: '/vela/v0/appearance/packs/owner/1/logo.svg' }, swatches: [] }] }, origin);
  const pack = model.packs[0]!;
  const doc = packDocument(cinematicDoc, pack);
  expect(doc.ui?.page).toBe('#123456');
  expect(() => resolveDocument(doc, 390, 'en', { wordmark: { url: pack.wordmark, width: 240, height: 60 } })).not.toThrow();
});
