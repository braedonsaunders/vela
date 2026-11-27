import { expect, test } from 'bun:test';
import { miniScrubResult, type MiniScrub } from '../src/widgets/media/mini-scrub';

const bounds = { x: 20, width: 200 };

test('release before measurement clears the preview and keeps the release point for the seek', () => {
  const press: MiniScrub = { pageX: 60, released: false };
  expect(miniScrubResult(press, 100)).toEqual({ preview: null, seek: null });
  const release = { ...press, pageX: 140, released: true };
  expect(miniScrubResult(release, 100)).toEqual({ preview: null, seek: null });
  expect(miniScrubResult({ ...release, bounds }, 100)).toEqual({ preview: null, seek: 60 });
});

test('a measured drag previews its latest position until release', () => {
  const press: MiniScrub = { pageX: 60, released: false, bounds };
  expect(miniScrubResult(press, 100)).toEqual({ preview: 20, seek: null });
  const move = { ...press, pageX: 120 };
  expect(miniScrubResult(move, 100)).toEqual({ preview: 50, seek: null });
  expect(miniScrubResult({ ...move, pageX: 250, released: true }, 100)).toEqual({ preview: null, seek: 100 });
});
