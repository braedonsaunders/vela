import { expect, test } from 'bun:test';
import { listForItem, listOffered, toggleSound } from '../src/widgets/media/now-playing-list';

const song = { chapters: false, lyrics: true };
const plainSong = { chapters: false, lyrics: false };
const book = { chapters: true, lyrics: false };

test('the Sound button opens Sound from any list', () => {
  expect(toggleSound('queue', 'queue', song)).toBe('sound');
  expect(toggleSound('lyrics', 'queue', song)).toBe('sound');
  expect(toggleSound('chapters', 'chapters', book)).toBe('sound');
});

test('pressed again, it goes back to the list Sound was opened over', () => {
  expect(toggleSound('sound', 'lyrics', song)).toBe('lyrics');
  expect(toggleSound('sound', 'queue', song)).toBe('queue');
  expect(toggleSound('sound', 'chapters', book)).toBe('chapters');
});

test('if that list is gone, it goes to the chapters or Up Next', () => {
  // The lyrics were open, and the next song has none.
  expect(toggleSound('sound', 'lyrics', plainSong)).toBe('queue');
  expect(toggleSound('sound', 'lyrics', book)).toBe('chapters');
  // Opened straight onto Sound.
  expect(toggleSound('sound', 'sound', plainSong)).toBe('queue');
});

test('a new item keeps Sound open, shows a book its chapters and keeps lyrics only where there are some', () => {
  expect(listForItem('sound', book)).toBe('sound');
  expect(listForItem('queue', book)).toBe('chapters');
  expect(listForItem('lyrics', song)).toBe('lyrics');
  expect(listForItem('lyrics', plainSong)).toBe('queue');
  expect(listForItem('chapters', plainSong)).toBe('queue');
});

test('Up Next and Sound are always offered', () => {
  expect(listOffered('queue', plainSong)).toBe(true);
  expect(listOffered('sound', plainSong)).toBe(true);
  expect(listOffered('chapters', song)).toBe(false);
  expect(listOffered('lyrics', song)).toBe(true);
});
