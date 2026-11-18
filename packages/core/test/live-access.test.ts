import { expect, test } from 'bun:test';
import { Live, initialLive } from '../src/store/live';
import type { Session } from '../src/store/session';
import type { Playback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';

test.each([true, false])('unavailable Live TV creates no controller (bootstrap loaded: %s)', async bootstrapped => {
  let reads = 0;
  const features = { liveTV: { available: false, reason: 'No accessible Plex DVR' } };
  const adapter = { channels() { reads++; }, guide() { reads++; }, describe: async () => ({ features }) };
  const session = {
    onReset() {}, ready: async () => ({ adapter }),
    features: bootstrapped ? features : undefined,
    tokens: async () => { throw new Error('Unavailable Live TV must not request tokens'); },
  };
  const box = new StateBox({ live: initialLive } as unknown as VelaState);
  const live = new Live(box, session as unknown as Session, {} as Playback);
  expect(await live.access()).toBeNull();
  expect(reads).toBe(0);
});
