import { expect, test } from 'bun:test';
import { VelaError, type PlaybackState } from '@vela/core';
import type { PlaybackPlan } from '../../protocol/types';
import { Tile } from '../src/widgets/guide/tile';
import type { LiveSource } from '../src/widgets/guide/source';
import { ownedStartFailure, startFailure, startFailureOf, startRetrying } from '../src/widgets/player/start-failure';
import { liveWatchOf } from '../src/widgets/player/target';

const initialPlayback: PlaybackState = { phase: 'idle', target: null, plan: null, sessionId: '', error: '', errorCode: '', errorClass: '', retryAfterSeconds: 0, retryAttempt: 0, live: null, versions: null };
const providerDown = (retry: { allowed: boolean; afterSeconds?: number; maxAttempts?: number }) => new VelaError(
  { class: 'source', code: 'network', message: 'The connection to the Live TV provider failed.', retry }, 503);
const watching = { open: true, canPreview: true, quiet: false, order: ['shift', 'bbc'], remembered: '' };
const settle = () => new Promise(r => setTimeout(r, 0));

test('a channel the server refuses as final gives up after one tune, with the server\'s reason', async () => {
  let tunes = 0;
  const source = { tune: async () => { tunes++; throw providerDown({ allowed: false }); }, stop: async () => {} } as unknown as LiveSource;
  const tile = new Tile(source, () => {}, () => {});
  tile.update(watching);
  tile.enterWatch('bbc');
  await settle();
  const view = tile.view();
  expect(view.state).toBe('unavailable');
  expect(view.plan).toBeNull();
  expect(view.retrying).toBeNull();
  expect(view.failure).toEqual({ message: 'The connection to the Live TV provider failed.', code: 'network', errorClass: 'source' });
  await new Promise(r => setTimeout(r, 30));
  expect(tunes).toBe(2); // the automatic candidate, then BBC One, once.
  tile.dispose();
});

test('Try again tunes the refused channel afresh and a success clears the failure', async () => {
  const tuned: string[] = [];
  let refuse = true;
  const source = {
    tune: async (id: string) => { tuned.push(id); if (refuse) throw providerDown({ allowed: false }); return { sessionId: id } as PlaybackPlan; },
    stop: async () => {},
  } as unknown as LiveSource;
  const tile = new Tile(source, () => {}, () => {});
  tile.update(watching);
  tile.enterWatch('bbc');
  await settle();
  expect(tile.view().failure).not.toBeNull();
  refuse = false;
  tile.restart('bbc');
  await settle();
  expect(tuned.at(-1)).toBe('bbc');
  expect(tile.view().failure).toBeNull();
  expect(tile.view().plan?.sessionId).toBe('bbc');
  tile.dispose();
});

test('a retryable refusal shows a retry on the server\'s terms, then tunes again', async () => {
  const tuned: string[] = [];
  let calls = 0;
  const source = {
    tune: async (id: string) => {
      tuned.push(id);
      if (id === 'bbc' && calls++ === 0) throw providerDown({ allowed: true, afterSeconds: 1, maxAttempts: 2 });
      return { sessionId: `${id}-${calls}` } as PlaybackPlan;
    },
    stop: async () => {},
  } as unknown as LiveSource;
  const tile = new Tile(source, () => {}, () => {});
  tile.update(watching);
  tile.enterWatch('bbc');
  await settle();
  expect(tile.view().failure).toBeNull();
  expect(tile.view().retrying).toEqual({ seconds: 1, message: 'The connection to the Live TV provider failed.' });
  expect(tile.view().state).toBe('connecting');
  await new Promise(r => setTimeout(r, 1100));
  expect(tuned.filter(id => id === 'bbc')).toHaveLength(2);
  expect(tile.view().retrying).toBeNull();
  expect(tile.view().plan).not.toBeNull();
  tile.dispose();
});

test('zapping away from a waiting retry cancels it', async () => {
  const tuned: string[] = [];
  const source = {
    tune: async (id: string) => { tuned.push(id); if (id === 'bbc') throw providerDown({ allowed: true, afterSeconds: 1 }); return { sessionId: id } as PlaybackPlan; },
    stop: async () => {},
  } as unknown as LiveSource;
  const tile = new Tile(source, () => {}, () => {});
  tile.update(watching);
  tile.enterWatch('bbc');
  await settle();
  expect(tile.view().retrying?.seconds).toBe(1);
  tile.enterWatch('shift');
  await new Promise(r => setTimeout(r, 1100));
  expect(tuned.filter(id => id === 'bbc')).toHaveLength(1);
  expect(tile.view().retrying).toBeNull();
  tile.dispose();
});

test('a refused channel is told in viewer words; a title keeps the server\'s message; capacity stays capacity', () => {
  const refusal = { message: 'The connection to the Live TV provider failed.', errorClass: 'source' };
  expect(startFailureOf(refusal, { kind: 'channel', id: 'bbc' })).toEqual({
    capacity: false,
    message: 'This channel isn\'t available right now: The connection to the Live TV provider failed.',
  });
  expect(startFailureOf({ message: '', errorClass: '' }, { kind: 'channel', id: 'bbc' }).message).toBe('This channel isn\'t available right now.');
  expect(startFailureOf(refusal, { kind: 'title', id: 't' }).message).toBe(refusal.message);
  expect(startFailureOf({ message: 'busy', errorClass: 'capacity' }, { kind: 'channel', id: 'c' }).capacity).toBe(true);
});

test('core\'s refused start is a failure only once it stops retrying, and a retry while it waits', () => {
  const target = { kind: 'channel', id: 'bbc' } as const;
  const failed = { ...initialPlayback, phase: 'failed' as const, error: 'The connection to the Live TV provider failed.', errorClass: 'source' };
  expect(startFailure(failed, target)?.message).toContain('This channel isn\'t available right now');
  expect(startRetrying(failed)).toBeNull();
  const waiting = { ...failed, retryAfterSeconds: 4, retryAttempt: 1 };
  expect(startFailure(waiting, target)).toBeNull();
  expect(startRetrying(waiting)).toEqual({ seconds: 4, message: failed.error });
  expect(startFailure({ ...initialPlayback, phase: 'starting' }, target)).toBeNull();
  expect(startRetrying({ ...initialPlayback, phase: 'starting' })).toBeNull();
});

test('a channel the tile owns ends in the error when core gives up on its session, though the tile still holds the plan', () => {
  const target = { kind: 'channel', id: 'bbc' } as const;
  // Playing, or restarting: nothing to show.
  expect(ownedStartFailure(null, { ...initialPlayback, phase: 'playing', target }, target)).toBeNull();
  expect(ownedStartFailure(null, { ...initialPlayback, phase: 'preparing', target }, target)).toBeNull();
  // Core gave up after its restarts (playback_stalled, no words of the server's): the channel's own message.
  const gaveUp = { ...initialPlayback, phase: 'failed' as const, target, errorCode: 'playback_stalled', errorClass: 'transient' };
  expect(ownedStartFailure(null, gaveUp, target)).toEqual({ capacity: false, message: 'This channel isn\'t available right now.' });
  // Another channel's failure is not this one's.
  expect(ownedStartFailure(null, { ...gaveUp, target: { kind: 'channel', id: 'itv' } }, target)).toBeNull();
  // The tile's own refusal comes first, with the server's reason.
  const refusal = { message: 'The connection to the Live TV provider failed.', code: 'network', errorClass: 'source' };
  expect(ownedStartFailure(refusal, initialPlayback, target)?.message).toBe('This channel isn\'t available right now: The connection to the Live TV provider failed.');
});

test('the chrome is live from the request target before any plan, and zaps from its channel', () => {
  expect(liveWatchOf(null, { kind: 'channel', id: 'bbc' })).toEqual({ live: true, channelId: 'bbc' });
  expect(liveWatchOf(null, { kind: 'library-live', id: 'cam' })).toEqual({ live: true, channelId: '' });
  expect(liveWatchOf(null, { kind: 'title', id: 't' })).toEqual({ live: false, channelId: '' });
  expect(liveWatchOf(null, undefined).live).toBe(false);
  expect(liveWatchOf({ channelId: 'shift' } as PlaybackPlan, { kind: 'channel', id: 'bbc' }).channelId).toBe('shift');
  expect(liveWatchOf({ live: true } as unknown as PlaybackPlan, { kind: 'title', id: 't' }).live).toBe(true);
});

test('a tune the server cancelled (overlapping zaps) is asked once more before anything is shown', async () => {
  const cancelled = () => new VelaError({ class: 'source', code: 'cancelled', message: 'The Live TV request was cancelled.', retry: { allowed: false } }, 503);
  const tuned: string[] = [];
  let refusals = 1;
  const source = {
    tune: async (id: string) => { tuned.push(id); if (id === 'bbc' && refusals-- > 0) throw cancelled(); return { sessionId: id } as PlaybackPlan; },
    stop: async () => {},
  } as unknown as LiveSource;
  const tile = new Tile(source, () => {}, () => {});
  tile.update(watching);
  tile.enterWatch('bbc');
  await new Promise(r => setTimeout(r, 10));
  expect(tuned.filter(id => id === 'bbc')).toHaveLength(2);
  expect(tile.view().failure).toBeNull();
  expect(tile.view().plan?.sessionId).toBe('bbc');
  // Cancelled again: told, not asked forever.
  refusals = 2;
  tile.restart('bbc');
  await new Promise(r => setTimeout(r, 10));
  expect(tuned.filter(id => id === 'bbc')).toHaveLength(4);
  expect(tile.view().failure?.code).toBe('cancelled');
  tile.dispose();
});
