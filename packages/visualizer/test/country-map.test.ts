import { expect, test } from 'bun:test';
import { bakeCountryMap, decodeCountryRuns, encodeCountryRuns } from '../tools/country-map';

test('country-map packing preserves ocean, adjacent IDs and runs longer than 16 bits', () => {
  const ids = new Uint8Array(70004);
  ids.fill(177, 1, 70001);
  ids.set([4, 1, 0], 70001);
  const runs = encodeCountryRuns(ids);
  expect(runs.length).toBe(36);
  expect(Buffer.from(decodeCountryRuns(runs, ids.length)).equals(Buffer.from(ids))).toBe(true);
  expect(() => decodeCountryRuns(runs, ids.length - 1)).toThrow('Invalid country map size');
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
