import { expect, test } from 'bun:test';
import { isMenuPress, rightClickAnswer } from '../src/context-menu-reopen';

const target = { claimed: false, editable: false, link: false, selection: false };

test('the secondary button, and Control-click only on a Mac, ask for a context menu', () => {
  expect(isMenuPress({ button: 2, ctrlKey: false }, false)).toBe(true);
  expect(isMenuPress({ button: 0, ctrlKey: true }, true)).toBe(true);
  expect(isMenuPress({ button: 0, ctrlKey: true }, false)).toBe(false);
  expect(isMenuPress({ button: 0, ctrlKey: false }, true)).toBe(false);
  expect(isMenuPress({ button: 1, ctrlKey: false }, true)).toBe(false);
});

test('a right-click that closes a menu opens the menu of the card under it', () => {
  expect(rightClickAnswer({ ...target, claimed: true })).toBe('vela');
  // A card's own menu wins even over its title's link.
  expect(rightClickAnswer({ ...target, claimed: true, link: true })).toBe('vela');
});

test('text fields, links and selected text keep the browser menu', () => {
  expect(rightClickAnswer({ ...target, editable: true })).toBe('browser');
  expect(rightClickAnswer({ ...target, link: true })).toBe('browser');
  expect(rightClickAnswer({ ...target, selection: true })).toBe('browser');
});

test('on empty space the right-click only closes the open menu', () => {
  expect(rightClickAnswer(target)).toBe('none');
});
