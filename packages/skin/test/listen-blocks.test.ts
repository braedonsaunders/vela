// The Listen rich blocks' pure rules (blocks/listen/part-style.ts, props.ts) and their registry
// (packages/protocol/rich-blocks.ts): parts layer by state, props read with their defaults, lists
// come from sources and records, discs group, playlist moves and the bar's side panels.
import { expect, test } from 'bun:test';
import type { Card } from '@vela/core';
import { RICH_BLOCKS, RICH_BLOCK_NAMES, isRichBlock } from '../../protocol/rich-blocks';
import { fillParts, hasRows, partRows, splitRows } from '../src/blocks/listen/part-style';
import {
  asCard, barPresses, cardOf, cardsOf, dedupeAlbums, releaseKind, shelfSubtitle, discGroups, litWords, listOf, moveItem, lyricLine, queueMove, nextRowCount, parseBool, parseEnum, parseNumber, playlistMove, propDefault, tableTracks, FIRST_ROWS, MORE_ROWS,
} from '../src/blocks/listen/props';

function track(id: string, disc = 0): Card {
  return { id, kind: 'track', name: id, media: { disc } } as unknown as Card;
}

test('every rich block names its parts after itself, and templates are parts', () => {
  for (const name of RICH_BLOCK_NAMES) {
    const spec = RICH_BLOCKS[name];
    for (const part of spec.parts) expect(part.startsWith(`${name}.`)).toBe(true);
    for (const template of spec.templates) expect(template.startsWith(`${name}.`)).toBe(true);
    for (const template of Object.keys((spec as { templateScope?: object }).templateScope ?? {})) expect((spec.templates as readonly string[]).includes(template)).toBe(true);
    for (const prop of Object.values(spec.props as Record<string, { type: string; values?: readonly string[]; default?: string }>)) {
      if (prop.type === 'enum') expect(prop.values?.length).toBeGreaterThan(0);
      if (prop.type === 'enum' && prop.default) expect(prop.values).toContain(prop.default);
      if (prop.type === 'boolean' && prop.default) expect(['true', 'false']).toContain(prop.default);
    }
  }
  expect(isRichBlock('trackTable')).toBe(true);
  expect(isRichBlock('toString')).toBe(false);
  expect(RICH_BLOCKS.trackTable.parts).toContain('trackTable.activeRow');
  expect(RICH_BLOCKS.queue.templates).toContain('queue.row');
  expect(RICH_BLOCKS.lyrics.parts).toContain('lyrics.activeLine');
});

test('parts fill once and layer base, hover, focus and pressed in order', () => {
  const parts = fillParts({
    'trackTable.row': { style: { 'border-radius': 'R', color: 'C' }, hover: { 'background-color': 'H' }, focus: { 'background-color': 'F' } },
    'trackTable.activeRow': { style: { color: 'A' }, active: { opacity: '0.5' } },
    'bar.root': { style: { 'background-color': '' } },
  }, t => (t === 'R' ? '6px' : t === 'C' ? '$ui.ink' : t === 'H' ? '$ui.control' : t === 'F' ? '$ui.controlHover' : t === 'A' ? '$ui.accent' : t));
  expect(partRows(parts, 'trackTable.row')).toEqual({ 'border-radius': '6px', color: '$ui.ink' });
  expect(partRows(parts, 'trackTable.row', { hover: true })['background-color']).toBe('$ui.control');
  // Focus beats hover; an empty filled row is dropped.
  expect(partRows(parts, 'trackTable.row', { hover: true, focus: true })['background-color']).toBe('$ui.controlHover');
  expect(hasRows(partRows(parts, 'bar.root'))).toBe(false);
  // The active row layers over the row.
  expect(partRows(parts, ['trackTable.row', 'trackTable.activeRow'], { active: true })).toEqual({ 'border-radius': '6px', color: '$ui.accent', opacity: '0.5' });
  expect(partRows(parts, ['trackTable.row', false && 'trackTable.activeRow']).color).toBe('$ui.ink');
  expect(hasRows(partRows(parts, 'queue.row'))).toBe(false);
});

test('a TV without a focus look shows the hover look', () => {
  const parts = fillParts({ 'rail.row': { style: {}, hover: { 'background-color': 'h' } } }, t => t);
  expect(partRows(parts, 'rail.row', { focus: true }, false)['background-color']).toBeUndefined();
  expect(partRows(parts, 'rail.row', { focus: true }, true)['background-color']).toBe('h');
});

test('a part splits into box rows and the rows its text takes', () => {
  expect(splitRows({ color: 'x', 'font-size': '14px', 'background-color': 'y', padding: '4px' }))
    .toEqual({ box: { 'background-color': 'y', padding: '4px' }, text: { color: 'x', 'font-size': '14px' } });
});

test('props parse with the registry defaults', () => {
  expect(parseBool('true', false)).toBe(true);
  expect(parseBool(false, true)).toBe(false);
  expect(parseBool('', true)).toBe(true);
  expect(parseBool('yes', false)).toBe(false);
  expect(parseNumber('300', 60, 0, 200)).toBe(200);
  expect(parseNumber('x', 60)).toBe(60);
  expect(parseEnum(' large ', ['compact', 'large'], 'compact')).toBe('large');
  expect(parseEnum('huge', ['compact', 'large'], 'compact')).toBe('compact');
  expect(propDefault('trackTable', 'header')).toBe('true');
  expect(propDefault('bar', 'queueFlag')).toBe('queue');
  expect(propDefault('trackTable', 'nothing')).toBe('');
});

test('lists come from list sources or plain lists; cards need an id, a name and a kind', () => {
  expect(listOf({ items: [1, 2], more: false })).toEqual([1, 2]);
  expect(listOf([3])).toEqual([3]);
  expect(listOf('x')).toEqual([]);
  expect(asCard({ id: 'a', name: 'A', kind: 'track' })?.id).toBe('a');
  expect(asCard({ id: 'a', name: 'A' })).toBeUndefined();
  expect(asCard(null)).toBeUndefined();
});

test('a track table follows item: records and keeps entry ids parallel to the tracks it keeps', () => {
  const records: Record<string, { rev: number; value: unknown }> = {
    'item:a': { rev: 1, value: track('a') },
    'item:c': { rev: 1, value: track('c') },
  };
  const read = (key: string) => records[key];
  const { tracks, entryIds } = tableTracks({ items: [{ $record: 'item:a' }, { $record: 'item:missing' }, { $record: 'item:c' }], more: false }, ['e1', 'e2', 'e3'], read);
  expect(tracks.map(t => t.id)).toEqual(['a', 'c']);
  expect(entryIds).toEqual(['e1', 'e3']);
  // Inline cards work too, without entry ids.
  expect(tableTracks([track('x')], undefined, read)).toEqual({ tracks: [track('x')], entryIds: [''] });
});

test('discs group only an album that spans two or more', () => {
  expect(discGroups([track('a', 1), track('b', 1)])).toEqual([{ disc: 0, indices: [0, 1] }]);
  expect(discGroups([track('a'), track('b')])).toEqual([{ disc: 0, indices: [0, 1] }]);
  expect(discGroups([track('a', 1), track('b', 1), track('c', 2)])).toEqual([{ disc: 1, indices: [0, 1] }, { disc: 2, indices: [2] }]);
});

test('a playlist move names the entry and the one it lands after', () => {
  const ids = ['a', 'b', 'c', 'd'];
  expect(playlistMove(ids, 0, 2)).toEqual({ entryId: 'a', afterEntryId: 'c' });
  expect(playlistMove(ids, 3, 0)).toEqual({ entryId: 'd', afterEntryId: null });
  expect(playlistMove(ids, 2, 1)).toEqual({ entryId: 'c', afterEntryId: 'a' });
  expect(playlistMove(ids, 1, 1)).toBeUndefined();
  expect(playlistMove(ids, 1, 9)).toBeUndefined();
  // The row drawn at once agrees with the move the store makes.
  expect(moveItem(ids, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  expect(moveItem(ids, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  expect(moveItem(ids, 3, 9)).toEqual(ids);
});

test('long lists draw their first rows, then more each frame, until all', () => {
  expect(nextRowCount(0, 10)).toBe(10);
  expect(nextRowCount(0, 1000)).toBe(FIRST_ROWS);
  expect(nextRowCount(FIRST_ROWS, 1000)).toBe(FIRST_ROWS + MORE_ROWS);
  expect(nextRowCount(990, 1000)).toBe(1000);
});

test('the bar opens one side panel at a time', () => {
  expect(barPresses('queue', 'queue', 'sound', {})).toEqual([{ action: 'toggle', flag: 'queue' }]);
  expect(barPresses('queue', 'queue', 'sound', { sound: 'true' })).toEqual([{ action: 'close', flag: 'sound' }, { action: 'toggle', flag: 'queue' }]);
  expect(barPresses('sound', 'q', 's', { q: 'true' })).toEqual([{ action: 'close', flag: 'q' }, { action: 'toggle', flag: 's' }]);
});

test('queue moves stay among the upcoming items', () => {
  expect(queueMove(5, 3, 2, 10)).toEqual({ from: 5, to: 3 });
  expect(queueMove(5, 2, 2, 10)).toBeUndefined();
  expect(queueMove(2, 5, 2, 10)).toBeUndefined();
  expect(queueMove(4, 4, 2, 10)).toBeUndefined();
  expect(queueMove(4, 10, 2, 10)).toBeUndefined();
});

test('lyrics light the line being sung and the words sung so far', () => {
  const lines = [{ startMs: 1000 }, { startMs: 4000 }, { startMs: 9000 }];
  expect(lyricLine(lines, 0)).toBe(-1);
  expect(lyricLine(lines, 800)).toBe(0);
  expect(lyricLine(lines, 5000)).toBe(1);
  expect(lyricLine(lines, 60000)).toBe(2);
  const words = [{ startMs: 4000 }, { startMs: 4400 }, { startMs: 5000 }];
  expect(litWords(words, 3000)).toBe(0);
  expect(litWords(words, 4200)).toBe(1);
  expect(litWords(words, 5000)).toBe(3);
});

test('a prop names a card by record, by a title source value, or as a card; lists follow records', () => {
  const records: Record<string, { rev: number; value: unknown }> = { 'item:a': { rev: 1, value: track('a') }, 'item:b': { rev: 1, value: track('b') } };
  const read = (key: string) => records[key];
  expect(cardOf({ $record: 'item:a' }, read)?.id).toBe('a');
  expect(cardOf({ item: { $record: 'item:b' } }, read)?.id).toBe('b');
  expect(cardOf(track('c'), read)?.id).toBe('c');
  expect(cardOf({ item: { $record: 'item:none' } }, read)).toBeUndefined();
  expect(cardsOf({ items: [{ $record: 'item:a' }, { $record: 'item:x' }, { $record: 'item:b' }], more: false }, read).map(c => c.id)).toEqual(['a', 'b']);
});

test('shelves show a song\'s album once, and word their tiles by kind', () => {
  const song = (id: string, album: string) => ({ id, kind: 'track', name: id, media: { parent: { id: album } } }) as unknown as Card;
  expect(dedupeAlbums([song('1', 'x'), song('2', 'x'), song('3', 'y')]).map(c => c.id)).toEqual(['1', '3']);
  expect([releaseKind(3), releaseKind(6), releaseKind(7)]).toEqual(['single', 'ep', 'album']);
  const album = { id: 'a', kind: 'album', name: 'A', yearLabel: '2019', media: { childCount: 9, byline: 'Lanterns' } } as unknown as Card;
  expect(shelfSubtitle(album, 'year')).toBe('2019');
  expect(shelfSubtitle(album, 'byline')).toBe('Lanterns');
  expect(shelfSubtitle(album, 'none')).toBeUndefined();
  expect(shelfSubtitle(album, 'release')?.startsWith('2019\u00a0·\u00a0')).toBe(true);
  expect(shelfSubtitle(album, 'playlist')).toBeUndefined();
});
