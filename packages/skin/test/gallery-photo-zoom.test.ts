import { describe, expect, test } from 'bun:test';
import { clampPhotoZoom, doubleTapPhoto, FIT_PHOTO, fitPhoto, photoCanSwipe, zoomPhoto } from '../src/blocks/gallery/photo-zoom';

describe('Gallery photo zoom and pan', () => {
  const viewport = { width: 300, height: 400 };

  test('clamps pan independently against the actual image edges and centres letterboxed axes', () => {
    expect(fitPhoto(viewport, 2)).toEqual({ width: 300, height: 150 });
    expect(clampPhotoZoom({ scale: 2, x: -500, y: 500 }, viewport, 2)).toEqual({ scale: 2, x: -150, y: 0 });
    expect(clampPhotoZoom({ scale: 4, x: 200, y: -500 }, viewport, 2)).toEqual({ scale: 4, x: 200, y: -100 });
    expect(clampPhotoZoom({ scale: 12, x: 4000, y: 4000 }, viewport, 2)).toEqual({ scale: 5, x: 600, y: 175 });
    expect(clampPhotoZoom({ scale: 0.5, x: -400, y: 400 }, viewport, 2)).toBe(FIT_PHOTO);
  });

  test('preserves the focal image point during pinch and follows a moving midpoint', () => {
    const from = { x: 75, y: 160 };
    const to = { x: 95, y: 175 };
    const pose = { scale: 2, x: 15, y: -10 };
    const next = zoomPhoto(pose, 3, from, to, viewport, 0.75);
    expect(next).toEqual({ scale: 3, x: 80, y: 20 });
    expect((from.x - 150 - pose.x) / pose.scale).toBe((to.x - 150 - next.x) / next.scale);
    expect((from.y - 200 - pose.y) / pose.scale).toBe((to.y - 200 - next.y) / next.scale);
  });

  test('double tap toggles fit and 2x around the point tapped', () => {
    const point = { x: 30, y: 305 };
    const enlarged = doubleTapPhoto(FIT_PHOTO, point, viewport, 0.75);
    expect(enlarged).toEqual({ scale: 2, x: 120, y: -105 });
    expect(doubleTapPhoto(enlarged, point, viewport, 0.75)).toBe(FIT_PHOTO);
  });

  test('only a fit-to-fit single-finger drag can page through photos', () => {
    const zoomed = { x: 0, y: 0, scale: 2 };
    expect(photoCanSwipe(FIT_PHOTO, FIT_PHOTO, false)).toBe(true);
    expect(photoCanSwipe(FIT_PHOTO, FIT_PHOTO, true)).toBe(false);
    expect(photoCanSwipe(FIT_PHOTO, zoomed, false)).toBe(false);
    expect(photoCanSwipe(zoomed, FIT_PHOTO, false)).toBe(false);
  });
});
