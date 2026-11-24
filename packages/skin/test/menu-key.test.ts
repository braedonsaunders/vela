import { expect, test } from 'bun:test';
import { backHolds, SAME_PRESS_MS } from '../src/back-holds';

/** tvOS: a Menu press reaches the Back listeners newest first until one takes it. */
function tvOS() {
  const listeners = new Set<() => boolean>();
  const menuKey: boolean[] = [];
  let clock = 0;
  const holds = backHolds({
    listen: handler => { listeners.add(handler); return () => listeners.delete(handler); },
    menuKey: enabled => menuKey.push(enabled),
    now: () => clock,
    later: () => 0,
    cancel: () => {},
  });
  const press = () => { for (const handler of [...listeners].reverse()) if (handler()) return true; return false; };
  return { holds, press, menuKey, wait: (ms: number) => { clock += ms; } };
}

test('a fallback hold takes Menu only when nothing else open holds it, whatever order they were made in', () => {
  const { holds, press, menuKey, wait } = tvOS();
  const taken: string[] = [];
  const nowPlaying = holds.hold(() => { taken.push('now playing'); return true; });
  // Made after Now Playing's (a section's effect running again), it still yields to it.
  const section = holds.hold(() => { taken.push('section'); return true; }, { fallback: true });
  expect(menuKey).toEqual([true]);
  expect(press()).toBe(true);
  expect(taken).toEqual(['now playing']);
  nowPlaying();
  wait(SAME_PRESS_MS + 1);
  expect(press()).toBe(true);
  expect(taken).toEqual(['now playing', 'section']);
  section();
  expect(menuKey).toEqual([true, false]);
  // Nothing held (Vela's Home): Menu goes to the system.
  expect(press()).toBe(false);
});

test("a section's fallback is not held for the screens pushed above it", () => {
  const { holds, wait } = tvOS();
  const taken: string[] = [];
  holds.hold(() => { taken.push('section'); return true; }, { fallback: true });
  wait(SAME_PRESS_MS + 1);
  expect(holds.held()).toBe(false);
  holds.fromNavigation();
  expect(taken).toEqual([]);
  // A real hold (an open menu) is, and the pushed screen's removal is handed to it.
  holds.hold(() => { taken.push('menu'); return true; });
  expect(holds.held()).toBe(true);
  holds.fromNavigation();
  expect(taken).toEqual(['menu']);
  // The same press reaching the native stack right after is not handled twice.
  holds.fromNavigation();
  expect(taken).toEqual(['menu']);
});
