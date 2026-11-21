// The keys of Vela's own Android TV keyboard (tv-keyboard.tsx) and what a press does to the text.
// Pure: the layout for a kind of field and mode, and the next state after a press.

/** What the field holds: an address, a name, a password or a search. */
export type KeyboardKind = 'url' | 'username' | 'password' | 'search';

export type Key =
  | { type: 'char'; char: string }
  | { type: 'shift' }
  | { type: 'symbols' }
  | { type: 'space' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'done' };

export interface KeyboardMode {
  /** Letters are capitals. */
  shift: boolean;
  /** The letter rows show punctuation instead. */
  symbols: boolean;
}

export interface KeyboardState extends KeyboardMode {
  value: string;
}

const DIGITS = '1234567890';
const LETTERS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const SYMBOLS = ['!@#$%^&*()', '-_=+[]{}\\', ';:\'",<>?/|~`'];
/** The characters an address or a name needs most, beside the space bar, without the symbol page. */
const EXTRA: Record<KeyboardKind, string> = {
  url: '.:/-_',
  username: '.-_@',
  password: '.-_@',
  search: '.-\'&',
};

const chars = (text: string): Key[] => [...text].map(char => ({ type: 'char', char }));

/** The rows, top to bottom: digits, three rows of letters (or punctuation), then the action row. */
export function keyboardRows(kind: KeyboardKind, mode: KeyboardMode): Key[][] {
  const letters = mode.symbols
    ? SYMBOLS
    : LETTERS.map(row => (mode.shift ? row.toUpperCase() : row));
  return [
    chars(DIGITS),
    chars(letters[0]!),
    [...chars(letters[1]!), { type: 'backspace' }],
    [{ type: 'shift' }, ...chars(letters[2]!)],
    [
      { type: 'symbols' },
      ...chars(EXTRA[kind]),
      ...(kind === 'url' ? [] : [{ type: 'space' } as Key]),
      { type: 'clear' },
      { type: 'done' },
    ],
  ];
}

/** The state after a key; `done` reports that the viewer finished (the caller submits). */
export function pressKey(state: KeyboardState, key: Key): { state: KeyboardState; done: boolean } {
  switch (key.type) {
    case 'char':
      return { state: { ...state, value: state.value + key.char }, done: false };
    case 'space':
      return { state: { ...state, value: `${state.value} ` }, done: false };
    case 'backspace':
      // Whole code points: an emoji pasted through the system keyboard leaves in one press.
      return { state: { ...state, value: [...state.value].slice(0, -1).join('') }, done: false };
    case 'clear':
      return { state: { ...state, value: '' }, done: false };
    case 'shift':
      return { state: { ...state, shift: !state.shift, symbols: false }, done: false };
    case 'symbols':
      return { state: { ...state, symbols: !state.symbols }, done: false };
    case 'done':
      return { state, done: true };
  }
}

/** A stable identity for a key in its row (React keys, test IDs). */
export function keyId(key: Key): string {
  return key.type === 'char' ? `char-${key.char.codePointAt(0)}` : key.type;
}

/** Whether Vela draws its own keyboard: Android TV, where the system keyboard's remote handling
 * differs from device to device (issue #4: a Shield could not move across it). */
export function ownKeyboard(os: string, tv: boolean): boolean {
  return os === 'android' && tv;
}
