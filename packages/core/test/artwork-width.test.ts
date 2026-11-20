import { expect, test } from 'bun:test';
import { artworkURL } from '../src/discovery/artwork';
import type { ArtworkRef } from '../src/wire';

const origin = 'https://fixture.test';
const grant = '?signature=a%2fb%2B+%20&w=3840&expiry=1000';
const image: ArtworkRef = { id: 'a', kind: 'backdrop', tag: 'fixture', sizes: [{ width: 3840, height: 2160, url: '/vela/v0/images/a' + grant }] };

test('browser Ether artwork lowers only its width and covers height as well as width', () => {
  const images = { origin, fitProxyWidth: true };
  expect(artworkURL(image, 1440, 900, images)).toBe(origin + '/vela/v0/images/a' + grant.replace('3840', '1600'));
  expect(artworkURL(image, 4500, 2400, images)).toBe(origin + '/vela/v0/images/a' + grant);
});

test('the proxy width is untouched on native and on foreign artwork origins', () => {
  expect(artworkURL(image, 1440, 900, { origin })).toBe(origin + '/vela/v0/images/a' + grant);
  const foreign = 'https://other.test/vela/v0/images/a' + grant;
  expect(artworkURL({ ...image, sizes: [{ ...image.sizes[0]!, url: foreign }] }, 1440, 900,
    { origin, fitProxyWidth: true })).toBe(foreign);
});
