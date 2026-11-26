// The audio app's keyboard, decided in core so the music widgets and the listen documents share it.
import { expect, test } from 'bun:test';
import { audioKey, isLiked, nextRate, runAudioKey, type AudioKeyInput } from '../src/audio/keys';

const press = (key: string, extra: Partial<AudioKeyInput> = {}) => audioKey({ key, meta: false, alt: false, shift: false, spoken: false, playing: true, ...extra });

test('music: space plays and pauses, arrows seek 5 s or change track, volume, mute, shuffle, repeat, like', () => {
  expect(press(' ')).toEqual({ kind: 'toggle' });
  expect(press('ArrowLeft')).toEqual({ kind: 'skip', seconds: -5 });
  expect(press('ArrowRight')).toEqual({ kind: 'skip', seconds: 5 });
  expect(press('ArrowRight', { shift: true })).toEqual({ kind: 'next' });
  expect(press('ArrowLeft', { shift: true })).toEqual({ kind: 'previous' });
  expect(press('ArrowUp')).toEqual({ kind: 'volume', delta: 0.1 });
  expect(press('M')).toEqual({ kind: 'mute' });
  expect(press('s')).toEqual({ kind: 'shuffle' });
  expect(press('r')).toEqual({ kind: 'repeat' });
  expect(press('[')).toBeNull();
  expect(press('l')).toEqual({ kind: 'like' });
});

test('spoken word: arrows skip 15/30 s, brackets change speed, no shuffle or repeat', () => {
  expect(press('ArrowLeft', { spoken: true })).toEqual({ kind: 'skip', seconds: -15 });
  expect(press('ArrowRight', { spoken: true })).toEqual({ kind: 'skip', seconds: 30 });
  expect(press(']', { spoken: true })).toEqual({ kind: 'rate', step: 1 });
  expect(press('s', { spoken: true })).toBeNull();
  expect(nextRate(1, 1)).toBe(1.25);
  expect(nextRate(2, 1)).toBe(2);
  expect(nextRate(1.1, -1)).toBe(0.75);
});

test('search, help and the queue work with nothing playing; the rest waits for something to play', () => {
  expect(press('k', { meta: true, playing: false })).toEqual({ kind: 'search' });
  expect(press('?', { playing: false })).toEqual({ kind: 'help' });
  expect(press('q', { playing: false })).toEqual({ kind: 'queue' });
  expect(press(' ', { playing: false })).toBeNull();
  expect(press('m', { meta: true })).toBeNull();
  expect(press('m', { alt: true })).toBeNull();
});

test('a focused button keeps Space and a slider its arrows', () => {
  expect(press(' ', { role: 'button' })).toBeNull();
  expect(press('ArrowLeft', { role: 'slider' })).toBeNull();
  expect(press('ArrowUp', { role: 'adjustable' })).toBeNull();
  expect(press('ArrowLeft', { role: 'button' })).toEqual({ kind: 'skip', seconds: -5 });
});

test('the store does its part; the app keeps the queue, search, help and like', () => {
  const calls: string[] = [];
  const audio = new Proxy({}, { get: (_t, name) => (...args: unknown[]) => { calls.push(`${String(name)}(${args.join(',')})`); } });
  const store = { getState: () => ({ audio: { volume: 0.5, rate: 1 } }), audio } as never;
  expect(runAudioKey(store, { kind: 'volume', delta: 0.1 })).toBe(true);
  expect(runAudioKey(store, { kind: 'rate', step: -1 })).toBe(true);
  expect(runAudioKey(store, { kind: 'queue' })).toBe(false);
  expect(runAudioKey(store, { kind: 'like' })).toBe(false);
  expect(calls).toEqual(['setVolume(0.6)', 'setRate(0.75)']);
});

test('liked: the role lists, the Favorites playlist, or the card itself', () => {
  const state = { music: { liked: { track: { value: { items: [{ id: 'a' }] } } } }, collections: { p: { value: { name: 'Favorites', items: [{ id: 'b' }] } } } } as never;
  expect(isLiked(state, { id: 'a' })).toBe(true);
  expect(isLiked(state, { id: 'b' })).toBe(true);
  expect(isLiked(state, { id: 'c', favorite: true })).toBe(true);
  expect(isLiked(state, { id: 'c' })).toBe(false);
});
