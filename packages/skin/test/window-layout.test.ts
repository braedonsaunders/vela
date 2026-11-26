import { expect, test } from 'bun:test';
import { barVolumeSlider, nowPlayingCompactLandscape, nowPlayingSideBySide, twoPanes, wideMusic } from '../src/widgets/media/window-layout';

// Windows in points, after the side safe areas (what Vela lays out in).
const duoFolded = { width: 466, height: 678 };
const duoFoldedLandscape = { width: 619, height: 466 };
const duoUnfolded = { width: 867, height: 669 }; // 951 pt less the Dynamic Island's 84 on the right
const duoUnfoldedUpright = { width: 669, height: 951 };
const iPadPortrait = { width: 834, height: 1194 };
const iPadLandscape = { width: 1194, height: 834 };
const iPadMiniPortrait = { width: 744, height: 1133 };

test('an unfolded iPhone Duo held open like a book gets the wide music app; folded it is a phone', () => {
  expect(wideMusic(duoUnfolded.width, duoUnfolded.height)).toBe(true);
  expect(wideMusic(duoFolded.width, duoFolded.height)).toBe(false);
  expect(wideMusic(duoFoldedLandscape.width, duoFoldedLandscape.height)).toBe(false);
  // Upright, the inner display is a small tablet held tall: one pane, as an iPad mini upright.
  expect(wideMusic(duoUnfoldedUpright.width, duoUnfoldedUpright.height)).toBe(false);
});

test('tablets keep their forms: upright compact, landscape wide', () => {
  expect(wideMusic(iPadPortrait.width, iPadPortrait.height)).toBe(false);
  expect(wideMusic(iPadMiniPortrait.width, iPadMiniPortrait.height)).toBe(false);
  expect(wideMusic(iPadLandscape.width, iPadLandscape.height)).toBe(true);
  // Any window from 980 is wide, whatever its shape (a tall desktop window).
  expect(wideMusic(980, 1400)).toBe(true);
  expect(wideMusic(979, 1400)).toBe(false);
});

test('a short landscape window narrower than 840 stays one pane', () => {
  expect(twoPanes(839, 500, 980)).toBe(false);
  expect(twoPanes(840, 500, 980)).toBe(true);
  // Square is not landscape.
  expect(twoPanes(900, 900, 980)).toBe(false);
});

test('Now Playing puts the cover beside Up Next on an unfolded Duo, not on a phone', () => {
  expect(nowPlayingSideBySide(duoUnfolded.width, duoUnfolded.height)).toBe(true);
  expect(nowPlayingSideBySide(duoUnfoldedUpright.width, duoUnfoldedUpright.height)).toBe(false);
  expect(nowPlayingSideBySide(duoFolded.width, duoFolded.height)).toBe(false);
  expect(nowPlayingSideBySide(900, 1200)).toBe(true);
  expect(nowPlayingSideBySide(899, 1200)).toBe(false);
});

test('a lower wide threshold than 840 is not raised by the landscape rule', () => {
  expect(twoPanes(700, 400, 600)).toBe(true);
  expect(twoPanes(599, 400, 600)).toBe(false);
});

test('no width yet (before the first layout) is one pane', () => {
  expect(twoPanes(0, 0, 980)).toBe(false);
  expect(twoPanes(Number.NaN, 600, 980)).toBe(false);
});

test('the bar keeps its volume slider only where it fits', () => {
  expect(barVolumeSlider(duoUnfolded.width)).toBe(false);
  expect(barVolumeSlider(iPadLandscape.width)).toBe(true);
});

test('short phone landscapes have separate transport and list panes', () => {
  expect(nowPlayingCompactLandscape(890, 384)).toBe(true);
  expect(nowPlayingCompactLandscape(594, 466)).toBe(true);
  expect(nowPlayingCompactLandscape(duoFoldedLandscape.width, duoFoldedLandscape.height)).toBe(true);
  expect(nowPlayingCompactLandscape(duoFolded.width, duoFolded.height)).toBe(false);
  expect(nowPlayingCompactLandscape(559, 360)).toBe(false);
  expect(nowPlayingCompactLandscape(duoUnfolded.width, duoUnfolded.height)).toBe(false);
  expect(nowPlayingCompactLandscape(890, 0)).toBe(false);
});
