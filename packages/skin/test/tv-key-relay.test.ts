// The remote's presses go to the focused controls only, through one listener.
import { expect, test } from 'bun:test';
import { tvKeyRelay, type TVKey } from '../src/tv-key-relay';

test('a press reaches the focused controls, and a removed one no more', () => {
  const relay = tvKeyRelay();
  const seen: (string | undefined)[] = [];
  const remove = relay.add({ current: (event: TVKey) => { seen.push(event.eventType); } });
  relay.dispatch({ eventType: 'right' });
  remove();
  relay.dispatch({ eventType: 'right' });
  expect(seen).toEqual(['right']);
  expect(relay.size).toBe(0);
});

test("tvOS's focus reports on the same channel are not presses", () => {
  const relay = tvKeyRelay();
  const seen: (string | undefined)[] = [];
  relay.add({ current: (event: TVKey) => { seen.push(event.eventType); } });
  relay.dispatch({ eventType: 'blur' });
  relay.dispatch({ eventType: 'focus' });
  relay.dispatch({ eventType: 'left' });
  expect(seen).toEqual(['left']);
});

test('the latest handler runs, without subscribing again', () => {
  const relay = tvKeyRelay();
  const seen: string[] = [];
  const ref = { current: (_event: TVKey) => { seen.push('first'); } };
  relay.add(ref);
  ref.current = () => { seen.push('second'); };
  relay.dispatch({ eventType: 'menu' });
  expect(seen).toEqual(['second']);
  expect(relay.size).toBe(1);
});

test('a handler that removes itself during a press does not stop the others', () => {
  const relay = tvKeyRelay();
  const seen: string[] = [];
  let removeA = () => {};
  removeA = relay.add({ current: () => { seen.push('a'); removeA(); } });
  relay.add({ current: () => { seen.push('b'); } });
  relay.dispatch({ eventType: 'select' });
  relay.dispatch({ eventType: 'select' });
  expect(seen).toEqual(['a', 'b', 'b']);
});
