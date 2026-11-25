// On TV the hero on show keeps its buttons as the carousel rotates, but titles differ in which
// buttons they have. When the focused one leaves, focus goes back to the hero's primary button
// (Play or Resume, else More info, Restart last), never to the pager.
import { expect, test } from 'bun:test';
import { heroButtonRank, heroFocusCarry } from '../src/hero-focus';

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
