import { expect, test } from 'bun:test';
import type { Title } from '../src/wire';
import { card } from '../src/discovery/models';
import { createQueue, current, cycleRepeat, jumpTo, next, previous, toggleShuffle, upNext } from '../src/audio/queue';
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
