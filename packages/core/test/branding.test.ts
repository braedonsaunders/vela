import { test, expect } from 'bun:test';
import { brandingModel } from '../src/appearance';
import { brandDocument } from '../../skin/src/branding';
test('owner branding resolves against its server and rejects invalid image sizes and origins', () => {
  expect(brandingModel(undefined, 'https://server.test')).toBeUndefined();
  expect(brandingModel({name: ' Family ', wordmark: {url: '/logo.png', width: 200, height: 50}}, 'https://server.test')).toEqual({name: 'Family', wordmark: {url: 'https://server.test/logo.png', width: 200, height: 50, dark: undefined}});
  expect(brandingModel({name: 'Family', wordmark: {url: 'https://other.test/logo.png', width: 200, height: 50}}, 'https://server.test')?.wordmark).toBeUndefined();
});
test('inherited and skin shell lockups use owner text with no image and preserve the original otherwise', () => {
  const doc = {children: [{type: 'image', src: 'assets/brand/vela-lockup-paper.svg'}]};
  expect(brandDocument(doc, undefined)).toBe(doc);
  expect(brandDocument(doc, {name: 'Family'}).children[0]).toMatchObject({type: 'text', text: 'Family'});
  expect(doc.children[0]?.type).toBe('image');
});

test('wordmark uses its intrinsic ratio and replaces Mochi paired mark and text together', () => {
  const doc = {type: 'box', children: [{type: 'image', src: '/vela/v0/appearance/skins/mochi/1/vela-mark.svg'}, {type: 'text', text: '{s:vela}'}]};
  const branded = brandDocument(doc, {name:'Family',wordmark:{url:'https://server.test/light.png',dark:'https://server.test/dark.png',width:200,height:100}}, '#ffffff');
  expect(JSON.stringify(branded)).toContain('light.png');
  expect(JSON.stringify(branded)).not.toContain('dark.png');
  expect(JSON.stringify(branded)).not.toContain('vela-mark.svg');
});
