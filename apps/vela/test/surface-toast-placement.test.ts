import { expect, test } from 'bun:test';
import { surfaceToastPlacement } from '../src/surface-toast-placement';

const base = {
  pathname: '/library/photos', sectionTop: 100, titleFallbackBottom: 174,
  clearance: 14, photoFullscreen: false,
};

test('section placement stays in force outside title frames', () => {
  expect(surfaceToastPlacement({ ...base, titleControlsBottoms: [220], photoFullscreen: true }))
    .toEqual({ top: 100, deferred: false });
});

test('every title leaves space after its actual controls, with room while they are measuring', () => {
  for (const id of ['film', 'book', 'photo']) {
    const title = { ...base, pathname: '/title/' + id };
    expect(surfaceToastPlacement(title)).toEqual({ top: 188, deferred: false });
    expect(surfaceToastPlacement({ ...title, titleControlsBottoms: [152] }))
      .toEqual({ top: 166, deferred: false });
    expect(surfaceToastPlacement({ ...title, titleControlsBottoms: [60] }))
      .toEqual({ top: 100, deferred: false });
  }
});

test('the toast stack clears the viewer chevrons below the top bar', () => {
  expect(surfaceToastPlacement({ ...base, pathname: '/title/photo', titleControlsBottoms: [152, 404, 156] }))
    .toEqual({ top: 418, deferred: false });
});

test('a fullscreen photo defers the stack until leaving fullscreen', () => {
  const title = { ...base, pathname: '/title/photo', titleControlsBottoms: [152] };
  expect(surfaceToastPlacement({ ...title, photoFullscreen: true })).toEqual({ top: 166, deferred: true });
  expect(surfaceToastPlacement(title)).toEqual({ top: 166, deferred: false });
});
