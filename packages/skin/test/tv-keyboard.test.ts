import { describe, expect, test } from 'bun:test';
import {
  keyboardRows,
  keyId,
  ownKeyboard,
  pressKey,
  type Key,
  type KeyboardKind,
  type KeyboardState,
} from '../src/widgets/common/tv-keyboard-model';

const start: KeyboardState = { value: '', shift: false, symbols: false };

/** Types a string by pressing the keys that carry its characters, switching pages as a viewer would. */
function type(kind: KeyboardKind, text: string, from = start): KeyboardState {
  const pages = [
    { shift: false, symbols: false },
    { shift: true, symbols: false },
    { shift: false, symbols: true },
  ];
  const has = (mode: { shift: boolean; symbols: boolean }, char: string) =>
    keyboardRows(kind, mode).flat().some(key => key.type === 'char' && key.char === char);
  let state = from;
  for (const char of text) {
    if (char === ' ') {
      state = pressKey(state, { type: 'space' }).state;
      continue;
    }
    if (!has(state, char)) {
      const page = pages.find(mode => has(mode, char));
      if (!page) throw new Error(`no key for ${char}`);
      if (state.symbols !== page.symbols) state = pressKey(state, { type: 'symbols' }).state;
      if (!page.symbols && state.shift !== page.shift) state = pressKey(state, { type: 'shift' }).state;
    }
    expect(has(state, char)).toBe(true);
    state = pressKey(state, { type: 'char', char }).state;
  }
  return state;
}

describe('Android TV keyboard', () => {
  test('is drawn only on Android TV', () => {
    expect(ownKeyboard('android', true)).toBe(true);
    expect(ownKeyboard('android', false)).toBe(false);
    expect(ownKeyboard('ios', true)).toBe(false);
    expect(ownKeyboard('web', false)).toBe(false);
  });

  test('an address types from the first page alone', () => {
    const rows = keyboardRows('url', start);
    const chars = rows.flat().flatMap(key => (key.type === 'char' ? [key.char] : []));
    for (const char of 'http://192.168.1.20:8096/ether-server_1') expect(chars).toContain(char);
    // An address has no spaces.
    expect(rows.flat().some(key => key.type === 'space')).toBe(false);
    expect(type('url', 'http://10.0.2.2:7848').value).toBe('http://10.0.2.2:7848');
  });

  test('every printable ASCII character can be typed, for passwords', () => {
    const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
    expect(type('password', printable).value).toBe(printable);
  });

  test('shift capitalises letters and the symbol page returns to letters', () => {
    const shifted = pressKey(start, { type: 'shift' }).state;
    expect(keyboardRows('username', shifted)[1]![0]).toEqual({ type: 'char', char: 'Q' });
    const symbols = pressKey(shifted, { type: 'symbols' }).state;
    expect(keyboardRows('username', symbols)[1]![0]).toEqual({ type: 'char', char: '!' });
    expect(pressKey(symbols, { type: 'shift' }).state.symbols).toBe(false);
  });

  test('editing keys change only the text; done reports without changing it', () => {
    const typed = type('search', 'ab');
    expect(pressKey(typed, { type: 'space' }).state.value).toBe('ab ');
    expect(pressKey(typed, { type: 'backspace' }).state.value).toBe('a');
    expect(pressKey({ ...typed, value: 'a😀' }, { type: 'backspace' }).state.value).toBe('a');
    expect(pressKey(start, { type: 'backspace' }).state.value).toBe('');
    expect(pressKey(typed, { type: 'clear' }).state.value).toBe('');
    expect(pressKey(typed, { type: 'done' })).toEqual({ state: typed, done: true });
  });

  test('switching pages keeps every row the same length at the positions the focus can be on', () => {
    // Keys are drawn by position: the shift and page keys sit where they were on every page.
    for (const kind of ['url', 'username', 'password', 'search'] as const) {
      const pages = [start, { ...start, shift: true }, { ...start, symbols: true }].map(mode => keyboardRows(kind, mode));
      for (const rows of pages) {
        expect(rows[3]![0]).toEqual({ type: 'shift' });
        expect(rows[4]![0]).toEqual({ type: 'symbols' });
        expect(rows[2]!.at(-1)).toEqual({ type: 'backspace' });
        expect(rows[4]!.at(-1)).toEqual({ type: 'done' });
      }
    }
  });

  test('key ids are unique on the letter pages', () => {
    for (const kind of ['url', 'username', 'password', 'search'] as const) {
      for (const shift of [false, true]) {
        const ids = keyboardRows(kind, { shift, symbols: false }).flat().map((key: Key) => keyId(key));
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});
