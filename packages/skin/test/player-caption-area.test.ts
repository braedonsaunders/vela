import { expect, test } from 'bun:test';
import { captionInsets, moveCaptionInsets } from '../src/widgets/player/caption-area';

const stage = { left: 0, top: 0, right: 1440, bottom: 900 };
const video = { ...stage, top: 45, bottom: 855 };

test('uses the top of the controls and restores the letterboxed video bounds', () => {
  expect(captionInsets(stage, video, Infinity)).toEqual({ left: 0, right: 0, top: 45, bottom: 45 });
  expect(captionInsets(stage, video, 760)).toMatchObject({ bottom: 150 });
  expect(captionInsets(stage, video, 880)).toMatchObject({ bottom: 45 });
});

test('leaves a column beside a side panel or a band above a phone menu', () => {
  const sidePanel = { left: 1080, top: 315, right: 1400, bottom: 805 };
  expect(captionInsets(stage, video, 760, [sidePanel])).toMatchObject({ right: 370, bottom: 150 });

  const phone = { left: 0, top: 0, right: 390, bottom: 844 };
  const portrait = { ...phone, top: 312, bottom: 532 };
  const menu = { left: 16, top: 442, right: 374, bottom: 770 };
  expect(captionInsets(phone, portrait, 750, [menu])).toEqual({ left: 0, right: 0, top: 312, bottom: 412 });
});

test('a phone in landscape leaves enough room beside a compact panel', () => {
  const phone = { left: 0, top: 0, right: 844, bottom: 390 };
  const landscape = { ...phone, left: 75, right: 769 };
  const panel = { left: 508, top: 110, right: 828, bottom: 324 };
  expect(captionInsets(phone, landscape, 290, [panel])).toEqual({ left: 75, right: 346, top: 0, bottom: 110 });
});

test('a tabletop picture stays at rest when the chrome is in the lower pane', () => {
  const picture = { left: 0, top: 24, right: 800, bottom: 390 };
  expect(captionInsets(picture, picture, 530, [{ left: 380, top: 410, right: 700, bottom: 590 }]))
    .toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
});

test('a transition can reverse from its current position without moving past either endpoint', () => {
  const shown = captionInsets(stage, video, 760);
  const hidden = captionInsets(stage, video, Infinity);
  const midway = moveCaptionInsets(hidden, shown, 0.5);
  expect(midway.bottom).toBeGreaterThan(hidden.bottom);
  expect(midway.bottom).toBeLessThan(shown.bottom);
  expect(moveCaptionInsets(midway, hidden, 0)).toEqual(midway);
  expect(moveCaptionInsets(midway, hidden, 1)).toEqual(hidden);
});
