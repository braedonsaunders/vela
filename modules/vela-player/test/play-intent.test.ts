import { expect, test } from 'bun:test';
import { PlayIntent, playErrorKind } from '../web/engine/play-intent';

function fixture() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  let plays = 0;
  let pauses = 0;
  const intent = new PlayIntent(() => {
    plays++;
    return new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  }, () => pauses++);
  return { intent, resolve: () => resolve(), reject: (e: unknown) => reject(e), counts: () => [plays, pauses] };
}
test('pause waits for pending play and does not interrupt it', async () => {
  const f = fixture();
  const play = f.intent.set(true);
  await Promise.resolve();
  const pause = f.intent.set(false);
  expect(f.counts()).toEqual([1, 0]);
  f.resolve();
  expect(await play).toBe(false);
  await pause;
  expect(f.counts()).toEqual([1, 1]);
});
test('latest play wins over an intervening pause without a second play', async () => {
  const f = fixture();
  const play = f.intent.set(true);
  await Promise.resolve();
  void f.intent.set(false);
  void f.intent.set(true);
  f.resolve();
  expect(await play).toBe(true);
  expect(f.counts()).toEqual([1, 0]);
});
test('retirement cannot pause replacement media or report stale failures', async () => {
  const f = fixture();
  const play = f.intent.set(true);
  await Promise.resolve();
  f.intent.retire();
  f.reject(new Error('old source'));
  expect(await play).toBe(false);
  expect(f.counts()).toEqual([1, 0]);
});
test('AbortError is cancellation, autoplay is blocked, real failures reject', async () => {
  expect(playErrorKind({ name: 'AbortError' })).toBe('cancelled');
  expect(playErrorKind(new DOMException('blocked', 'NotAllowedError'))).toBe('blocked');
  expect(playErrorKind(new Error('decode'))).toBe('failure');
  const f = fixture();
  const play = f.intent.set(true);
  await Promise.resolve();
  f.reject({ name: 'AbortError' });
  expect(await play).toBe(false);
  const next = f.intent.set(true);
  await Promise.resolve();
  f.reject(new Error('network'));
  await expect(next).rejects.toThrow('network');
});
test('pause before startup executes avoids calling play at all', async () => {
  const f = fixture();
  const play = f.intent.set(true);
  void f.intent.set(false);
  expect(await play).toBe(false);
  expect(f.counts()).toEqual([0, 1]);
});
test('duplicate play intents still report real current failures', async () => {
  const f = fixture();
  const play = f.intent.set(true);
  await Promise.resolve();
  void f.intent.set(true);
  f.reject(new DOMException('blocked', 'NotAllowedError'));
  await expect(play).rejects.toMatchObject({ name: 'NotAllowedError' });
});
