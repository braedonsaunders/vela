import { expect, test } from 'bun:test';
import { bakeCountryMap } from '../tools/country-map';

import { packTexture, unpackTexture } from '../tools/texture-bytes';

test('country-map packing preserves ocean, adjacent IDs and runs longer than 16 bits', () => {
  const ids = new Uint8Array(70004);
  ids.fill(177, 1, 70001);
  ids.set([4, 1, 0], 70001);
  const runs = packTexture(ids);
  expect(runs.length).toBeLessThan(ids.length / 20);
  expect(Buffer.from(unpackTexture(runs, ids.length)).equals(Buffer.from(ids))).toBe(true);
  expect(() => unpackTexture(runs, ids.length - 1)).toThrow('exceeds its image');
});

test('native map baking preserves independent formats, texels and sampling for both factories', () => {
  const source = `{
    function worldMapTexture(){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,2,1,0,gl.RED,gl.UNSIGNED_BYTE,new Uint8Array([0,177]));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);return t;}
    function hydroTexture(){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RG8,2,1,0,gl.RG,gl.UNSIGNED_BYTE,new Uint8Array([97,0,0,255]));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);return t;}
    scene({init(){worldMapTexture();hydroTexture();}});
  }`;
  function capture(part: string) {
    const calls: unknown[][] = [];
    const gl = {
      TEXTURE_2D: 0x0de1, R8: 0x8229, RG8: 0x822b, RED: 0x1903, RG: 0x8227,
      UNSIGNED_BYTE: 0x1401, TEXTURE_MIN_FILTER: 0x2801, NEAREST: 0x2600, LINEAR: 0x2601,
      createTexture: () => ({}), bindTexture() {},
      texImage2D(...args: unknown[]) { calls.push(args); }, texParameteri(...args: unknown[]) { calls.push(args); },
    };
    new Function('gl', 'scene', part)(gl, (s: {init(): void}) => s.init());
    return calls;
  }
  expect(capture(bakeCountryMap(source))).toEqual(capture(source));
});

test('texture packets preserve literal boundaries and repeats mixed with antialiased glyph coverage', () => {
  const bytes = Uint8Array.from({ length: 1025 }, (_, i) => i % 200 < 130 ? i & 255 : 0);
  expect(unpackTexture(packTexture(bytes), bytes.length)).toEqual(bytes);
  expect(unpackTexture(packTexture(new Uint8Array()), 0)).toHaveLength(0);
  expect(() => unpackTexture('', 1)).toThrow('Incomplete texture');
});
