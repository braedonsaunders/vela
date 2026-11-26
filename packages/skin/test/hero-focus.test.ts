// On TV the hero on show keeps its buttons as the carousel rotates, but titles differ in which
// buttons they have. When the focused one leaves, focus goes back to the hero: on a viewer-driven
// page turn, to the edge matching the turn direction (Play/Resume on a left turn, More info on a
// right turn); otherwise to the hero's primary button (Play or Resume, else More info, Restart
// last), never to the pager.
import { expect, test } from 'bun:test';
import { heroButtonRank, heroEdgeKeyGate, heroFocusCarry } from '../src/hero-focus';

const resume = heroButtonRank('play', 'title-1');
const restart = heroButtonRank('play', 'title-1|||0');
const moreInfo = heroButtonRank('select', 'movie|title-1');

test('Play and Resume rank first, More info next, Restart last', () => {
  expect(resume).toBeLessThan(moreInfo);
  expect(moreInfo).toBeLessThan(restart);
});

test('a focused button leaving hands focus to the primary button arriving in its place', () => {
  const carry = heroFocusCarry<string>();
  carry.add('psycho-resume', resume);
  carry.focused('psycho-resume', true);
  expect(carry.remove('psycho-resume')).toBe(true);
  // A title with nothing to resume: More info and a fresh Play arrive in the same redraw, Play
  // drawn after Restart's sibling would have been.
  carry.add('derry-more', moreInfo);
  carry.add('derry-play', resume);
  expect(carry.take()).toBe('derry-play');
});

test('a title with nothing to play hands focus to More info', () => {
  const carry = heroFocusCarry<string>();
  carry.add('moon-resume', resume);
  carry.add('moon-more', moreInfo);
  carry.focused('moon-resume', true);
  expect(carry.remove('moon-resume')).toBe(true);
  carry.remove('moon-more');
  carry.add('clover-more', moreInfo);
  expect(carry.take()).toBe('clover-more');
});

test('Restart arriving with Resume does not win the focus', () => {
  const carry = heroFocusCarry<string>();
  carry.add('clover-more', moreInfo);
  carry.focused('clover-more', true);
  expect(carry.remove('clover-more')).toBe(true);
  carry.add('psycho-restart', restart);
  carry.add('psycho-resume', resume);
  carry.add('psycho-more', moreInfo);
  expect(carry.take()).toBe('psycho-resume');
});

test('focus on a leaving Restart goes to the primary button that stays', () => {
  const carry = heroFocusCarry<string>();
  carry.add('primary', resume);
  carry.add('psycho-restart', restart);
  carry.focused('psycho-restart', true);
  expect(carry.remove('psycho-restart')).toBe(true);
  expect(carry.take()).toBe('primary');
});

test('a focused button only redrawn (released and bound again) loses nothing', () => {
  const carry = heroFocusCarry<string>();
  carry.add('more', moreInfo);
  carry.add('resume', resume);
  carry.focused('more', true);
  expect(carry.remove('more')).toBe(true);
  carry.add('more', moreInfo);
  expect(carry.take()).toBeUndefined();
  // It still counts as focused: leaving for real later hands focus on.
  expect(carry.remove('more')).toBe(true);
  expect(carry.take()).toBe('resume');
});

test('a button leaving without focus hands nothing on', () => {
  const carry = heroFocusCarry<string>();
  carry.add('resume', resume);
  carry.add('restart', restart);
  carry.focused('resume', true);
  expect(carry.remove('restart')).toBe(false);
  expect(carry.take()).toBeUndefined();
});

test('focus moved away from the hero is not handed back', () => {
  const carry = heroFocusCarry<string>();
  carry.add('resume', resume);
  carry.focused('resume', true);
  carry.focused('resume', false);
  expect(carry.remove('resume')).toBe(false);
});

test('leaving Home with every hero button hands focus to nothing', () => {
  const carry = heroFocusCarry<string>();
  carry.add('resume', resume);
  carry.add('more', moreInfo);
  carry.focused('resume', true);
  expect(carry.remove('resume')).toBe(true);
  carry.remove('more');
  expect(carry.take()).toBeUndefined();
});

test('hero action edges are the first and last ranked buttons', () => {
  const carry = heroFocusCarry<string>();
  carry.add('resume', resume);
  carry.add('more', moreInfo);
  carry.add('restart', restart);
  expect(carry.atEdge('resume', -1)).toBe(true);
  expect(carry.atEdge('more', -1)).toBe(false);
  expect(carry.atEdge('restart', 1)).toBe(true);
});

test('measured, the outermost button is where the buttons stand, not their rank', () => {
  // Resume, Restart, More info stand left to right; Restart ranks last for focus hand-over.
  const carry = heroFocusCarry<string>();
  carry.add('resume', resume);
  carry.add('restart', restart);
  carry.add('more', moreInfo);
  const x = { resume: 76, restart: 374, more: 546 } as Record<string, number>;
  const at = (target: string) => x[target];
  expect(carry.atEdge('restart', 1)).toBe(true);
  expect(carry.atEdge('restart', 1, at)).toBe(false);
  expect(carry.atEdge('more', 1, at)).toBe(true);
  expect(carry.atEdge('resume', -1, at)).toBe(true);
  expect(carry.atEdge('restart', -1, at)).toBe(false);
  expect(carry.targets()).toEqual(['resume', 'restart', 'more']);
});

test('the focused hero button is known with the time focus came to it', () => {
  const carry = heroFocusCarry<string>();
  carry.add('resume', resume);
  carry.add('more', moreInfo);
  expect(carry.current()).toBeUndefined();
  carry.focused('resume', true, 1000);
  carry.focused('more', true, 1500);
  carry.focused('resume', false, 1500);
  expect(carry.current()).toEqual({ target: 'more', since: 1500 });
  carry.focused('more', false, 2000);
  expect(carry.current()).toBeUndefined();
});

test('a right turn onto a multi-button title hands focus to the rightmost button (More info, never Play or Restart)', () => {
  const carry = heroFocusCarry<string>();
  carry.add('show-more', moreInfo);
  carry.focused('show-more', true, 1000);
  carry.turn(1, 2000);
  expect(carry.remove('show-more')).toBe(true);
  // Incoming title has Resume, Restart, and More info: Restart ranks 2 > More info's 1, but stands
  // in the middle visually, so a right turn must land on More info.
  carry.add('film-resume', resume);
  carry.add('film-restart', restart);
  carry.add('film-more', moreInfo);
  expect(carry.take(undefined, 2020)).toBe('film-more');
});

test('a left turn onto a multi-button title hands focus to the leftmost button (Play or Resume)', () => {
  const carry = heroFocusCarry<string>();
  carry.add('show-more', moreInfo);
  carry.focused('show-more', true, 1000);
  carry.turn(-1, 2000);
  expect(carry.remove('show-more')).toBe(true);
  carry.add('film-more', moreInfo);
  carry.add('film-restart', restart);
  carry.add('film-resume', resume);
  expect(carry.take(undefined, 2020)).toBe('film-resume');
});

test('directional handover respects measured screen positions when provided', () => {
  const carry = heroFocusCarry<string>();
  carry.add('old-more', moreInfo);
  carry.focused('old-more', true, 1000);
  carry.turn(1, 2000);
  expect(carry.remove('old-more')).toBe(true);
  carry.add('a', resume);
  carry.add('b', moreInfo);
  const xs: Record<string, number> = { a: 400, b: 100 };
  expect(carry.take(target => xs[target], 2020)).toBe('a');
});

test('a stale turn direction never leaks into a later automatic rotation', () => {
  const carry = heroFocusCarry<string>();
  carry.add('play', resume);
  carry.add('more', moreInfo);
  carry.focused('more', true, 1000);
  // Right turn where More info stayed mounted (only redrawn): take clears pending turn.
  carry.turn(1, 2000);
  expect(carry.remove('more')).toBe(true);
  carry.add('more', moreInfo);
  expect(carry.take(undefined, 2020)).toBeUndefined();
  // Later automatic rotation removes More info: falls back to primary Play, not More info.
  expect(carry.remove('more')).toBe(true);
  carry.remove('play');
  carry.add('next-play', resume);
  carry.add('next-more', moreInfo);
  expect(carry.take(undefined, 11000)).toBe('next-play');

  // Even without an intervening redraw, a turn older than the redraw window expires before auto-rotation.
  carry.focused('next-more', true, 11020);
  carry.turn(1, 12000);
  expect(carry.remove('next-more')).toBe(true);
  carry.remove('next-play');
  carry.add('later-play', resume);
  carry.add('later-more', moreInfo);
  expect(carry.take(undefined, 21000)).toBe('later-play');
});

test('Android edge key gate rejects inward presses regardless of hold length and allows edge presses immediately', () => {
  const gate = heroEdgeKeyGate();

  // Normal 150ms inward press (Play -> More info): moved focus, must not turn.
  gate.key(1, true, 'hero-primary', 1000);
  gate.focused(1010);
  gate.key(1, false, 'hero-more', 1150);
  expect(gate.stayed(1, 1150, 1010, 300)).toBe(false);

  // Fast double-tap (120ms later RIGHT on More info): stayed on More info, turns immediately
  // without being dropped by the 300ms fallback settle window.
  gate.key(1, true, 'hero-more', 1270);
  gate.key(1, false, 'hero-more', 1350);
  expect(gate.stayed(1, 1350, 1010, 300)).toBe(true);

  // Long-held 400ms inward press (More info -> Play): exceeds 300ms, still rejected because focus moved.
  gate.key(-1, true, 'hero-more', 3000);
  gate.focused(3012);
  gate.key(-1, false, 'hero-primary', 3400);
  expect(gate.stayed(-1, 3400, 3012, 300)).toBe(false);

  // Auto-repeat key-down after focus already moved does not overwrite the original down focus.
  gate.key(1, true, 'hero-primary', 5000);
  gate.focused(5008);
  gate.key(1, true, 'hero-more', 5500);
  gate.key(1, false, 'hero-more', 5600);
  expect(gate.stayed(1, 5600, 5008, 300)).toBe(false);

  // Super-fast tap where onFocus arrives after key-up on unnamed views (e.g. Restart with testID "").
  gate.key(1, true, '', 7000);
  gate.key(1, false, '', 7005);
  gate.focused(7020);
  expect(gate.stayed(1, 7005, 7020, 300)).toBe(false);

  // Key-down when nothing was focused ("none") never counts as staying at an edge.
  gate.key(1, true, 'none', 8000);
  gate.focused(8010);
  gate.key(1, false, 'hero-primary', 8150);
  expect(gate.stayed(1, 8150, 8010, 300)).toBe(false);

  // Fallback when no MainActivity key events were observed preserves settledMs gating.
  const fallback = heroEdgeKeyGate();
  expect(fallback.stayed(1, 1150, 1000, 300)).toBe(false);
  expect(fallback.stayed(1, 1400, 1000, 300)).toBe(true);
});

test('full hero focus and paging sequence across playable and More-info-only slides', () => {
  const carry = heroFocusCarry<string>();
  const gate = heroEdgeKeyGate();
  const xPlayable: Record<string, number> = { play: 38.5, more: 122.5 };
  const xMoreOnly: Record<string, number> = { moreOnly: 38.5 };

  // Slide 1/6: [Play, More info], starting on Play.
  carry.add('play', resume);
  carry.add('more', moreInfo);
  carry.focused('play', true, 0);

  // Before any turn: RIGHT (Play -> More info) and LEFT (More info -> Play) only move focus.
  gate.key(1, true, 'hero-primary', 1000);
  carry.focused('play', false, 1010);
  carry.focused('more', true, 1010);
  gate.focused(1010);
  gate.key(1, false, 'hero-more', 1150);
  expect(gate.stayed(1, 1150, 1010, 300)).toBe(false);
  expect(carry.current()?.target).toBe('more');

  gate.key(-1, true, 'hero-more', 2000);
  carry.focused('more', false, 2010);
  carry.focused('play', true, 2010);
  gate.focused(2010);
  gate.key(-1, false, 'hero-primary', 2150);
  expect(gate.stayed(-1, 2150, 2010, 300)).toBe(false);
  expect(carry.current()?.target).toBe('play');

  // Move to More info, then RIGHT turn onto a More-info-only slide (2/6), then RIGHT turn onto
  // playable slide (3/6): focus lands on More info (the right edge), NOT Play.
  carry.focused('play', false, 3000);
  carry.focused('more', true, 3000);
  gate.key(1, true, 'hero-more', 4000);
  gate.key(1, false, 'hero-more', 4150);
  expect(gate.stayed(1, 4150, 3000, 300)).toBe(true);
  expect(carry.atEdge('more', 1, t => xPlayable[t])).toBe(true);

  // 1/6 -> 2/6 (More info only).
  carry.turn(1, 4270);
  carry.remove('play');
  expect(carry.remove('more')).toBe(true);
  carry.add('moreOnly', moreInfo);
  expect(carry.take(undefined, 4290)).toBe('moreOnly');
  carry.focused('moreOnly', true, 4305);
  gate.focused(4305);

  // 2/6 -> 3/6 (RIGHT turn onto playable [Play, More info]): lands on More info!
  gate.key(1, true, 'hero-more', 6000);
  gate.key(1, false, 'hero-more', 6150);
  expect(gate.stayed(1, 6150, 4305, 300)).toBe(true);
  expect(carry.atEdge('moreOnly', 1, t => xMoreOnly[t])).toBe(true);
  carry.turn(1, 6270);
  expect(carry.remove('moreOnly')).toBe(true);
  carry.add('play3', resume);
  carry.add('more3', moreInfo);
  expect(carry.take(undefined, 6290)).toBe('more3');
  carry.focused('more3', true, 6305);
  gate.focused(6305);

  // Next inward press (LEFT from More info on 3/6): moves focus to Play ONLY, does NOT turn back!
  gate.key(-1, true, 'hero-more', 8000);
  carry.focused('more3', false, 8010);
  carry.focused('play3', true, 8010);
  gate.focused(8010);
  gate.key(-1, false, 'hero-primary', 8150);
  expect(gate.stayed(-1, 8150, 8010, 300)).toBe(false);
  expect(carry.current()?.target).toBe('play3');

  // LEFT turn from Play on 3/6 onto playable slide 2': lands on Play (left edge).
  gate.key(-1, true, 'hero-primary', 10000);
  gate.key(-1, false, 'hero-primary', 10150);
  expect(gate.stayed(-1, 10150, 8010, 300)).toBe(true);
  carry.turn(-1, 10270);
  expect(carry.remove('play3')).toBe(true);
  carry.remove('more3');
  carry.add('play2', resume);
  carry.add('more2', moreInfo);
  expect(carry.take(undefined, 10290)).toBe('play2');
});
