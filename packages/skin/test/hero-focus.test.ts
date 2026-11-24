// On TV a focused hero button can leave as the carousel rotates (the title now on show has other
// buttons); the hero button arriving in its place takes the focus back, once.
import { expect, test } from 'bun:test';
import { HERO_FOCUS_CARRY_MS, heroFocusCarry } from '../src/hero-focus';

test('a focused hero button that leaves hands its focus to the one arriving', () => {
  const carry = heroFocusCarry();
  carry.left(true, 1000);
  expect(carry.arrives(1000)).toBe(true);
});

test('the focus is handed on once', () => {
  const carry = heroFocusCarry();
  carry.left(true, 1000);
  expect(carry.arrives(1000)).toBe(true);
  expect(carry.arrives(1001)).toBe(false);
});

test('a hero button that leaves without focus hands nothing on', () => {
  const carry = heroFocusCarry();
  carry.left(false, 1000);
  expect(carry.arrives(1000)).toBe(false);
});

test('a hero button arriving long after the focused one left does not take focus', () => {
  const carry = heroFocusCarry();
  carry.left(true, 1000);
  expect(carry.arrives(1000 + HERO_FOCUS_CARRY_MS + 1)).toBe(false);
});

test('an unfocused button leaving in the same redraw keeps the focused one\'s hand-off', () => {
  const carry = heroFocusCarry();
  carry.left(true, 1000);
  carry.left(false, 1000);
  expect(carry.arrives(1000)).toBe(true);
});
