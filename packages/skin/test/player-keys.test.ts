import { expect, test } from 'bun:test';
import { keyboardControl } from '../src/widgets/player/key-target';

const el = (tag: string, role: string | null, focusVisible: boolean) => ({
  tagName: tag, getAttribute: (name: string) => (name === 'role' ? role : null),
  matches: (selector: string) => selector === ':focus-visible' && focusVisible,
}) as unknown as EventTarget;

test('Space presses a button only when the viewer reached it with the keyboard', () => {
  expect(keyboardControl(el('BUTTON', null, true))).toBe(true);
  expect(keyboardControl(el('DIV', 'button', true))).toBe(true);
});

test('a button that only holds focus because it was clicked (full screen) leaves Space to play and pause', () => {
  expect(keyboardControl(el('BUTTON', null, false))).toBe(false);
  expect(keyboardControl(el('DIV', 'button', false))).toBe(false);
});

test('anything that is not a control never takes Space', () => {
  expect(keyboardControl(el('DIV', null, true))).toBe(false);
  expect(keyboardControl(null)).toBe(false);
});
