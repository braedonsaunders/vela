// A hero trailer holds the carousel only while it plays: once it ends, fails or reaches its cap,
// that hero is not asked for again until the carousel moves on.
import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { HERO_PLAY_MS, Previews, initialPreviews } from '../src/store/previews';
import { StateBox } from '../src/store/state';
import type { Session } from '../src/store/session';
import type { VelaState } from '../src/store';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

function harness() {
  const box = new StateBox({ previews: initialPreviews, home: { value: { rows: [] } } } as unknown as VelaState);
  const session = { epoch: 1, onReset: () => () => {} } as unknown as Session;
  const previews = new Previews(box, session);
  const asked: string[] = [];
  (previews as unknown as { coordinatorFor(): Promise<unknown> }).coordinatorFor = async () => ({
    request: async (id: string) => { asked.push(id); return { cardId: id, url: `https://trailers.example/${id}.mp4`, expiresAt: Date.now() + 600_000, retryAfterSeconds: 0 }; },
    cancel: async () => {},
  });
  return { previews, asked, playing: () => box.get().previews.heroId };
}

test('a hero whose trailer ended is not asked for again while it stays on show', async () => {
  const { previews, asked, playing } = harness();
  previews.setContext({ allowed: true, heroId: 'top-gun' });
  jest.advanceTimersByTime(3000); await settle();
  expect(playing()).toBe('top-gun');
  previews.heroDone('top-gun');
  expect(playing()).toBe('');
  jest.advanceTimersByTime(60_000); await settle();
  expect(asked).toEqual(['top-gun']);
  expect(playing()).toBe('');
});

test('a hero trailer that never ends stops holding the carousel at the cap', async () => {
  const { previews, playing } = harness();
  previews.setContext({ allowed: true, heroId: 'top-gun' });
  jest.advanceTimersByTime(3000); await settle();
  expect(playing()).toBe('top-gun');
  jest.advanceTimersByTime(HERO_PLAY_MS); await settle();
  expect(playing()).toBe('');
});

test('the next hero plays its trailer, and a hero coming round again plays again', async () => {
  const { previews, asked, playing } = harness();
  previews.setContext({ allowed: true, heroId: 'a' });
  jest.advanceTimersByTime(3000); await settle();
  previews.heroDone('a');
  previews.setContext({ allowed: true, heroId: 'b' });
  jest.advanceTimersByTime(3000); await settle();
  expect(playing()).toBe('b');
  previews.heroDone('b');
  previews.setContext({ allowed: true, heroId: 'a' });
  jest.advanceTimersByTime(3000); await settle();
  expect(asked).toEqual(['a', 'b', 'a']);
  expect(playing()).toBe('a');
});
