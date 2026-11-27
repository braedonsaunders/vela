// A document's font files become @font-face rules on the web. Only CSS's own values for a face's
// weight and style reach the rule, and the family and source are written as CSS strings, so no
// value can close the rule and add others.
import { expect, test } from 'bun:test';
import { fontFaceRule } from '../src/font-face';
import { installedDocument } from '../src/installed';
import { documentKeyframes } from '../src/keyframes';

const origin = 'https://ether.test';
const href = `${origin}/vela/v0/appearance/skins/owner/1.0.0/a.woff2`;

test('built-in weights and styles make one @font-face rule each', () => {
  expect(fontFaceRule('Instrument Serif', href, 400, 'normal'))
    .toBe(`@font-face{font-family:"Instrument Serif";src:url("${href}");font-weight:400;font-style:normal;font-display:swap}`);
  for (const [weight, style] of [[400, 'italic'], ['200 1000', 'normal'], ['300 700', 'normal'], ['400 700', 'normal'], [700, 'oblique'], ['bold', 'normal']] as const) {
    const rule = fontFaceRule('Face', href, weight, style)!;
    expect(rule).toContain(`font-weight:${weight};font-style:${style};`);
  }
});

test('a style or weight that is not a CSS value makes no rule', () => {
  const style = 'normal} body{background-image:image-set("https://collector.example/s1" 1x)} /*';
  expect(fontFaceRule('Proof', href, 400, style)).toBeUndefined();
  expect(fontFaceRule('Proof', href, '400;} body{color:red} /*', 'normal')).toBeUndefined();
  for (const weight of ['', '0', '1001', '400 700 900', 'bolder', '4e2', '400px', ' 400']) expect(fontFaceRule('Proof', href, weight, 'normal')).toBeUndefined();
  for (const bad of ['Italic', 'oblique 10deg', '', 'normal;']) expect(fontFaceRule('Proof', href, 400, bad)).toBeUndefined();
});

test('the family and source cannot leave their CSS strings', () => {
  const rule = fontFaceRule('a"}body{color:red}\n/*\\', 'data:font/woff2;base64,AA"),url(x', 400, 'normal')!;
  // One rule: the only braces are the rule's own, and every quote in a value is escaped.
  expect(rule.match(/[{}]/g)).toHaveLength(2);
  expect(rule).toStartWith('@font-face{font-family:"a\\22 \\7d body\\7b color:red\\7d \\a /*\\5c ";src:url("data:font/woff2;base64,AA\\22 ),url(x");');
  expect(rule).toEndWith(';font-display:swap}');
});

test('an installed skin with a font face outside the grammar is refused', () => {
  const doc = (file: object) => ({ schema: 1, renderer: 18, id: 'owner', name: 'Owner', version: '1.0.0', swatches: ['#000000'], ui: {},
    fonts: { text: { family: 'Proof', files: [{ url: '/vela/v0/appearance/skins/owner/1.0.0/a.woff2', weight: 400, style: 'normal', ...file }] } } });
  expect(installedDocument(doc({}), origin).id).toBe('owner');
  expect(installedDocument(doc({ weight: '300 700', style: 'italic' }), origin).id).toBe('owner');
  expect(() => installedDocument(doc({ style: 'normal} body{background:red} /*' }), origin)).toThrow();
  expect(() => installedDocument(doc({ weight: '400;} body{background:red} /*' }), origin)).toThrow();
  expect(() => installedDocument(doc({ weight: { toString: null } }), origin)).toThrow();
});

test("a document keyframe's translate is a length or a percentage, never other text", () => {
  const frames = documentKeyframes({ a: { from: { translate: '-2.4% 10px' }, to: { translate: '0%}body{color:red}x% 0px' } } });
  expect(frames['doc:a']!.from!.transform).toEqual([{ translateX: '-2.4%' }, { translateY: 10 }]);
  expect(frames['doc:a']!.to!.transform).toEqual([{ translateX: 0 }, { translateY: 0 }]);
});
