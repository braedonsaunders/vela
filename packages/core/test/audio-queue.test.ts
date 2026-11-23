import { expect, test } from 'bun:test';
import type { Title } from '../src/wire';
import { card } from '../src/discovery/models';
import { clearQueued, createQueue, current, cycleRepeat, enqueue, jumpTo, moveTo, next, previous, queuedNext, removeAt, sourceNext, toggleShuffle, upNext } from '../src/audio/queue';
import { chapterEnd } from '../src/store/audio';

const track: Title = { id: 't', kind: 'episode', name: 'Low Tide', summary: '', genres: [], artwork: [], durationSeconds: 222,
  media: { class: 'music', role: 'track', index: 3, parents: [{ id: 'album-1', name: 'Harbour Lights', role: 'album' }] } };
const items = ['a', 'b', 'c', 'd', 'e'].map(id => card({ ...track, id }));
const fixed = () => 0.5;

test('a queue plays in order from the chosen item and ends without repeat', () => {
  let queue = createQueue(items, 2);
  expect(current(queue)?.id).toBe('c');
  expect(upNext(queue).map(c => c.id)).toEqual(['d', 'e']);
  queue = next(queue)!; queue = next(queue)!;
  expect(current(queue)?.id).toBe('e');
  expect(next(queue, true)).toBeUndefined();
  expect(next(queue)).toBeUndefined();
});

test('repeat all wraps, repeat one replays only when the item ends by itself', () => {
  let queue = cycleRepeat(createQueue(items, 4));
  expect(queue.repeat).toBe('all');
  expect(current(next(queue, true)!)?.id).toBe('a');
  queue = cycleRepeat(queue);
  expect(queue.repeat).toBe('one');
  expect(current(next(queue, true)!)?.id).toBe('e');
  expect(next(cycleRepeat(queue))).toBeUndefined();
  expect(cycleRepeat(queue).repeat).toBe('off');
});

test('previous restarts after three seconds, else steps back', () => {
  const queue = createQueue(items, 2);
  expect(previous(queue, 10).restart).toBe(true);
  const back = previous(queue, 1);
  expect(back.restart).toBe(false);
  expect(current(back.queue)?.id).toBe('b');
  expect(previous(createQueue(items, 0), 1).restart).toBe(true);
});

test('shuffle keeps the chosen item first and every item once; off restores order', () => {
  const queue = createQueue(items, 3, { shuffle: true }, fixed);
  expect(current(queue)?.id).toBe('d');
  expect([...queue.order].sort()).toEqual([0, 1, 2, 3, 4]);
  const unshuffled = toggleShuffle(queue);
  expect(unshuffled.shuffle).toBe(false);
  expect(current(unshuffled)?.id).toBe('d');
  expect(upNext(unshuffled).map(c => c.id)).toEqual(['e']);
  const reshuffled = toggleShuffle(unshuffled, fixed);
  expect(current(reshuffled)?.id).toBe('d');
  expect(reshuffled.order.length).toBe(5);
});

test('jumping plays a chosen item of the queue', () => {
  expect(current(jumpTo(createQueue(items, 0), 4))?.id).toBe('e');
  expect(jumpTo(createQueue(items, 0), 9).at).toBe(0);
});

test('a chapter ends at its end, else where the next begins', () => {
  const chapters = [{ id: '1', name: 'One', startSeconds: 0 }, { id: '2', name: 'Two', startSeconds: 60, endSeconds: 110 }, { id: '3', name: 'Three', startSeconds: 120 }];
  expect(chapterEnd(chapters, 30)).toBe(60);
  expect(chapterEnd(chapters, 70)).toBe(110);
  expect(chapterEnd(chapters, 130)).toBeUndefined();
});

const ids = (cards: { id: string }[]) => cards.map(c => c.id);
const extra = (id: string) => card({ ...track, id });

test('play next goes straight after the current item, add to queue after what is already queued', () => {
  let queue = createQueue(items, 1);
  queue = enqueue(queue, [extra('x')], 'last');
  queue = enqueue(queue, [extra('y')], 'last');
  queue = enqueue(queue, [extra('z')], 'next');
  expect(current(queue)?.id).toBe('b');
  expect(ids(queuedNext(queue))).toEqual(['z', 'x', 'y']);
  expect(ids(sourceNext(queue))).toEqual(['c', 'd', 'e']);
  expect(ids(upNext(queue))).toEqual(['z', 'x', 'y', 'c', 'd', 'e']);
  queue = next(queue)!;
  expect(current(queue)?.id).toBe('z');
  expect(ids(queuedNext(queue))).toEqual(['x', 'y']);
});

test('jumping past queued items drops them from the viewer queue; clear keeps the source', () => {
  let queue = enqueue(createQueue(items, 0), [extra('x'), extra('y')], 'last');
  const cleared = clearQueued(queue);
  expect(ids(upNext(cleared))).toEqual(['b', 'c', 'd', 'e']);
  queue = jumpTo(queue, queue.items.findIndex(c => c.id === 'c'));
  expect(current(queue)?.id).toBe('c');
  expect(queuedNext(queue)).toEqual([]);
});

test('remove and move keep the current item playing and the lanes honest', () => {
  let queue = enqueue(createQueue(items, 0), [extra('x')], 'last');
  queue = removeAt(queue, 2); // b
  expect(ids(upNext(queue))).toEqual(['x', 'c', 'd', 'e']);
  expect(removeAt(queue, queue.at)).toBe(queue);
  queue = moveTo(queue, 4, 1); // e into the viewer's queue, ahead of x
  expect(ids(queuedNext(queue))).toEqual(['e', 'x']);
  queue = moveTo(queue, 1, 4); // e back out to the end of the source
  expect(ids(queuedNext(queue))).toEqual(['x']);
  expect(ids(upNext(queue))).toEqual(['x', 'c', 'd', 'e']);
  expect(current(queue)?.id).toBe('a');
});

test('shuffle keeps the viewer queue right after the item playing, on and off', () => {
  let queue = enqueue(createQueue(items, 0), [extra('x'), extra('y')], 'last');
  queue = toggleShuffle(queue, fixed);
  expect(current(queue)?.id).toBe('a');
  expect(ids(upNext(queue)).slice(0, 2)).toEqual(['x', 'y']);
  queue = toggleShuffle(queue, fixed);
  expect(ids(upNext(queue))).toEqual(['x', 'y', 'b', 'c', 'd', 'e']);
});
