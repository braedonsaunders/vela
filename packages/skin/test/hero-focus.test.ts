// On TV the hero on show keeps its buttons as the carousel rotates, but titles differ in which
// buttons they have. When the focused one leaves, focus goes back to the hero: on a viewer-driven
// page turn, to the edge matching the turn direction (Play/Resume on a left turn, More info on a
// right turn); otherwise to the hero's primary button (Play or Resume, else More info, Restart
// last), never to the pager.
import { expect, test } from 'bun:test';
import { androidHeroPageDirection, appleHeroInput, heroAfterTurn, heroButtonRank, heroFocusCarry, heroHorizontalMove } from '../src/hero-focus';

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

test('mounted hero actions are ordered Play or Resume, Restart, then More info', () => {
  const carry = heroFocusCarry<string>();
  carry.add('restart', restart);
  carry.add('more', moreInfo);
  carry.add('resume', resume);
  expect(carry.visualTargets()).toEqual(['resume', 'restart', 'more']);
  carry.remove('restart');
  expect(carry.visualTargets()).toEqual(['resume', 'more']);
  carry.remove('resume');
  expect(carry.visualTargets()).toEqual(['more']);
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

test('Android hero buttons page only on a fresh outward key-down', () => {
  const carry = heroFocusCarry<string>();
  const playable = ['Play', 'Restart', 'More info'];
  const slides = [playable, ['More info'], playable, playable, playable, playable];
  let slide = 2;
  let buttons = slides[slide]!;
  let focus = 'Play';
  const mount = () => {
    buttons.forEach(button => carry.add(button, button === 'Play' ? resume : button === 'Restart' ? restart : moreInfo));
  };
  mount();
  const key = (type: 'left' | 'right', action = 0, repeat = 0) => {
    const neighbor = buttons[buttons.indexOf(focus) + (type === 'left' ? -1 : 1)];
    const direction = androidHeroPageDirection({
      eventType: type, eventKeyAction: action, repeatCount: repeat, heroTag: 42, withinHero: !!neighbor,
    });
    if (direction) {
      buttons.forEach(button => carry.remove(button));
      slide = (slide + direction + slides.length) % slides.length;
      buttons = slides[slide]!;
      mount();
      focus = carry.visualTargets()[heroAfterTurn(buttons.length, direction, []).focus]!;
    } else if (neighbor && action === 0 && repeat === 0) focus = neighbor;
    return [slide + 1, focus];
  };

  expect(key('left')).toEqual([2, 'More info']);
  expect(key('left', 0, 1)).toEqual([2, 'More info']);
  expect(key('left', 1)).toEqual([2, 'More info']);
  expect(key('left')).toEqual([1, 'Play']);
  expect(key('right')).toEqual([1, 'Restart']);
  expect(key('right', 0, 2)).toEqual([1, 'Restart']);
  expect(key('right')).toEqual([1, 'More info']);
  expect(key('right')).toEqual([2, 'More info']);
  expect(key('right')).toEqual([3, 'More info']);
  expect(key('right')).toEqual([4, 'More info']);
  expect(key('left')).toEqual([4, 'Restart']);
  expect(key('left')).toEqual([4, 'Play']);
  expect(key('left')).toEqual([3, 'Play']);
  expect(androidHeroPageDirection({ eventType: 'left', eventKeyAction: 0, repeatCount: 0 })).toBeUndefined();
});

test('queued presses replay from the incoming edge against its available actions', () => {
  expect(heroAfterTurn(2, 1, [{ direction: -1 }])).toEqual({ focus: 0 });
  expect(heroAfterTurn(3, 1, [{ direction: -1 }, { direction: -1 }])).toEqual({ focus: 0 });
  expect(heroAfterTurn(1, 1, [{ direction: -1 }])).toEqual({ focus: 0, turn: -1, remaining: [] });
  expect(heroAfterTurn(2, -1, [{ direction: 1 }, { direction: 1 }, { direction: -1 }]))
    .toEqual({ focus: 1, turn: 1, remaining: [{ direction: -1 }] });
});

test('tvOS arrows move exactly one button or turn once from the edge', () => {
  const left = appleHeroInput({ eventType: 'left', eventKeyAction: 1 })!;
  const right = appleHeroInput({ eventType: 'right', eventKeyAction: 1 })!;

  expect(heroHorizontalMove(0, 2, right)).toEqual({ focus: 1 });
  expect(heroHorizontalMove(1, 2, right)).toEqual({ focus: 1, turn: 1 });
  expect(heroHorizontalMove(1, 2, left)).toEqual({ focus: 0 });
  expect(heroHorizontalMove(0, 2, left)).toEqual({ focus: 0, turn: -1 });

  expect(heroHorizontalMove(0, 1, right)).toEqual({ focus: 0, turn: 1 });
  expect(heroHorizontalMove(0, 1, left)).toEqual({ focus: 0, turn: -1 });
  expect(heroHorizontalMove(1, 3, right)).toEqual({ focus: 2 });
  expect(heroHorizontalMove(1, 3, left)).toEqual({ focus: 0 });
  expect(heroHorizontalMove(-1, 0, right)).toEqual({ focus: -1 });
});

test('tvOS ignores arrow down and hold events and pages on a swipe from any action', () => {
  expect(appleHeroInput({ eventType: 'right', eventKeyAction: 0 })).toBeUndefined();
  expect(appleHeroInput({ eventType: 'longRight', eventKeyAction: 1 })).toBeUndefined();
  expect(appleHeroInput({ eventType: 'right' })).toBeUndefined();
  const forward = appleHeroInput({ eventType: 'swipeLeft' })!;
  const back = appleHeroInput({ eventType: 'swipeRight' })!;
  expect(heroHorizontalMove(0, 3, forward)).toEqual({ focus: 0, turn: 1 });
  expect(heroHorizontalMove(2, 3, back)).toEqual({ focus: 2, turn: -1 });
  expect(heroAfterTurn(3, -1, [forward, back])).toEqual({ focus: 0, turn: 1, remaining: [back] });
});
