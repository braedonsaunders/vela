// A mouse click on the picture plays or pauses; a double click changes full screen only and leaves
// playback as it was before its first click (issue #40).
import { expect, test } from 'bun:test';
import { DOUBLE_CLICK_MS, NO_CLICK, pictureClick, type ClickMemory, type PictureClick } from '../src/widgets/player/picture-click';

const at = (now: number, over: Partial<PictureClick> = {}): PictureClick =>
  ({ now, playing: true, canToggle: true, fullscreen: true, ...over });

/** The commands a run of clicks sends, each with when it goes: with its click, or after it. */
function clicks(...run: PictureClick[]) {
  let memory: ClickMemory = NO_CLICK;
  const sent: string[] = [];
  for (const click of run) {
    const outcome = pictureClick(memory, click);
    memory = outcome.memory;
    if (outcome.now) sent.push(outcome.now);
    if (outcome.later) sent.push(`later ${outcome.later}`);
  }
  return sent;
}

test('one click pauses a playing picture and plays a paused one', () => {
  expect(clicks(at(1000))).toEqual(['pause']);
  expect(clicks(at(1000, { playing: false }))).toEqual(['play']);
});

test('the first click works at any clock reading, zero included', () => {
  expect(clicks(at(0))).toEqual(['pause']);
});

test('a double click on a playing picture goes full screen, then plays again', () => {
  // The second click reads the view as still playing (its snapshot has not arrived): the undo is
  // the one recorded with the first click, not a second toggle from that stale state.
  expect(clicks(at(1000), at(1150))).toEqual(['pause', 'fullscreen', 'later play']);
});

test('a double click on a paused picture goes full screen, then pauses again', () => {
  expect(clicks(at(1000, { playing: false }), at(1150, { playing: false }))).toEqual(['play', 'fullscreen', 'later pause']);
  // Also when the snapshot after the first click has already arrived.
  expect(clicks(at(1000, { playing: false }), at(1150, { playing: true }))).toEqual(['play', 'fullscreen', 'later pause']);
});

test('full screen always goes out with the second click itself', () => {
  const outcome = pictureClick({ at: 1000, undo: 'play' }, at(1100));
  expect(outcome.now).toBe('fullscreen');
  expect(outcome.later).toBe('play');
});

test('without full screen a double click only undoes its first click, at once', () => {
  expect(clicks(at(1000, { fullscreen: false }), at(1150, { fullscreen: false }))).toEqual(['pause', 'play']);
});

test('a first click that sent nothing leaves nothing to undo', () => {
  // Ended, or no plan yet: the double click still changes full screen.
  expect(clicks(at(1000, { canToggle: false }), at(1150, { canToggle: false }))).toEqual(['fullscreen']);
  expect(clicks(at(1000, { canToggle: false, fullscreen: false }), at(1150, { canToggle: false, fullscreen: false }))).toEqual([]);
});

test('clicks further apart than the double-click window are two single clicks', () => {
  expect(clicks(at(1000), at(1000 + DOUBLE_CLICK_MS, { playing: false }))).toEqual(['pause', 'play']);
  expect(clicks(at(1000), at(1000 + DOUBLE_CLICK_MS - 1))).toEqual(['pause', 'fullscreen', 'later play']);
});

test('a third click starts over as a single click', () => {
  // The chrome passes the state the pending undo would restore (playing), and cancels that undo.
  expect(clicks(at(1000), at(1100), at(1200))).toEqual(['pause', 'fullscreen', 'later play', 'pause']);
  // Two double clicks in a row: in and out of full screen, playing throughout.
  expect(clicks(at(1000), at(1100), at(1200), at(1300))).toEqual(['pause', 'fullscreen', 'later play', 'pause', 'fullscreen', 'later play']);
});
