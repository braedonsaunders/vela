import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mapAtlasSource } from '../tools/map-atlas';
import manifest from '../assets/contour-labels.json';

test('native map atlas uploads the verified GL row order and requests trilinear mipmaps', () => {
  let uploaded: unknown[] = [];
  const calls: unknown[][] = [];
  const gl = {
    TEXTURE_2D: 0x0de1, R8: 0x8229, RED: 0x1903, UNSIGNED_BYTE: 0x1401,
    TEXTURE_MIN_FILTER: 0x2801, LINEAR_MIPMAP_LINEAR: 0x2703,
    createTexture: () => ({}), bindTexture() {},
    texImage2D(...args: unknown[]) { uploaded = args; },
    texParameteri(...args: unknown[]) { calls.push(args); },
    generateMipmap(target: number) { calls.push(['mipmap', target]); },
  };
  const upload = new Function('gl', 'let textAtlas;\n' + mapAtlasSource() + '\nreturn textAtlas;')(gl);
  const { labels, columns, cellWidth, cellHeight, font, width, height } = manifest;
  expect(upload(labels, columns, cellWidth, cellHeight, font)).toMatchObject({ rows: 5, cols: 4, n: 20 });
  expect(uploaded.slice(0, 8)).toEqual([gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE]);
  const expected = readFileSync(path.join(import.meta.dir, '../assets/contour-labels.r8'));
  expect(Buffer.from(uploaded[8] as Uint8Array).equals(expected)).toBe(true);
  expect(calls).toContainEqual(['mipmap', gl.TEXTURE_2D]);
  expect(calls).toContainEqual([gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR]);
  expect(() => upload([...labels].reverse(), columns, cellWidth, cellHeight, font)).toThrow('layout changed');
});
