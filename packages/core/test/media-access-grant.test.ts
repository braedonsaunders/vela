// The player host's media grant belongs to the signed-in session (#36). A rotated credential (an
// Ether token refresh) gives the next asker a new grant and retires the old one; whoever follows the
// session's grant must then hold the new one, or films, live TV and previews lose media access.
import { expect, test } from 'bun:test';
import { Playback, initialPlayback, type MediaAccessGrant } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import { tokens } from './helpers';

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function harness() {
  let current = tokens('access-1');
  const resets = new Set<() => void>();
  const connection = {
    record: { id: 'lab', name: 'Lab', kind: 'ether', origin: 'https://ether.example', basePath: '/' },
    // A standalone app's Ether grant: a scope, no headers.
    media: { origin: 'https://ether.example', pathPrefix: '/sessions/', headers: async () => ({ seen: current.accessToken }), nativeURL: async (url: string) => url },
  };
  const session = {
    epoch: 0,
    onReset: (listener: () => void) => { resets.add(listener); return () => resets.delete(listener); },
    ready: async () => connection,
    tokens: async () => current,
    selected: () => connection,
  };
  const box = new StateBox({ playback: initialPlayback, auth: { phase: 'signed-in' } } as unknown as VelaState);
  const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
  const installed: (MediaAccessGrant | null)[] = [];
  return {
    playback, installed,
    refresh: (accessToken: string) => { current = { ...current, accessToken }; },
    signOut: () => { for (const reset of resets) reset(); },
  };
}

test('a grant asked for after a token refresh replaces the installed one, and the follower installs it', async () => {
  const h = harness();
  h.playback.followMediaAccess(grant => h.installed.push(grant));
  await settle();
  expect(h.installed).toHaveLength(1);
  const first = h.installed[0]!;
  expect(await first.headers()).toEqual({ seen: 'access-1' });

  // The session's grant reads its headers live, so a refresh alone leaves it working.
  h.refresh('access-2');
  expect(await first.headers()).toEqual({ seen: 'access-2' });
  expect(h.installed).toHaveLength(1);

  // The audio queue asks again for its next item: the old grant is retired...
  const forAudio = await h.playback.mediaAccess();
  await settle();
  await expect(first.headers()).rejects.toThrow('Media authorization was replaced');
  // ...and the session now holds the same grant the audio queue was given.
  expect(h.installed).toHaveLength(2);
  const second = h.installed[1]!;
  expect(second.handle).toBe(forAudio!.handle);
  expect(second.handle).not.toBe(first.handle);
  expect(await second.headers()).toEqual({ seen: 'access-2' });
});

test('asking again with an unchanged credential keeps the installed grant', async () => {
  const h = harness();
  h.playback.followMediaAccess(grant => h.installed.push(grant));
  await settle();
  await h.playback.mediaAccess();
  await h.playback.mediaAccess();
  await settle();
  expect(h.installed).toHaveLength(1);
  expect(await h.installed[0]!.headers()).toEqual({ seen: 'access-1' });
});

test('a follower that stopped installs nothing more, and a new sign-in is not a replacement', async () => {
  const h = harness();
  const stop = h.playback.followMediaAccess(grant => h.installed.push(grant));
  await settle();
  stop();
  h.refresh('access-2');
  await h.playback.mediaAccess();
  await settle();
  expect(h.installed).toHaveLength(1);

  // Sign-out drops the grant; the next session's owner follows afresh (one install, no replacement).
  h.signOut();
  const next: (MediaAccessGrant | null)[] = [];
  h.playback.followMediaAccess(grant => next.push(grant));
  await settle();
  expect(next).toHaveLength(1);
});
