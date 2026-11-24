// Screen document pipes and paths (docs/plugin-screens.md: Bindings): what a hole draws.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { withLocale } from '@vela/core';
import { compileTemplate, type HoleScope } from '../src/screen/holes';
import { dayText, initials, setPipeClock, startText } from '../src/screen/pipes';
import { crest, readable, tint } from '../src/screen/colour';
import { screenRoot } from '../src/screen/items';
import { text, walk } from '../src/screen/scope';
import type { ScreenPageState } from '../../core/src/screens/types';
import type { Ctx, Env } from '../src/vocabulary';

const env = { small: false, tv: false, still: false, width: 1440 } as Env;
const records: Record<string, { rev: number; value: unknown }> = {
  'event:a': { rev: 2, value: { id: 'a', phase: 'live', sides: [{ name: 'Montréal Canadiens', abbr: 'MTL', color: '#af1e2d', score: '1' }, { name: 'Leafs', color: '#f0f0f0', altColor: '#00205b', score: '2' }] } },
  'event:b': { rev: 1, value: { id: 'b', phase: 'final', sides: [] } },
};
function page(over: Partial<ScreenPageState> = {}): ScreenPageState {
  return { href: 'h', key: 'k', params: { league: 'nhl' }, sources: { hero: { events: [{ $record: 'event:a' }, { $record: 'event:b' }], count: 0, ratio: 0.18 } },
    pending: { hero: true }, errors: { live: 'timeout' }, load: 'ready', rev: 1, ...over };
}
const reads: string[] = [];
const ctx = (p = page()): Ctx => screenRoot(p, key => { reads.push(key); return records[key]; }, { open: 'true' });
const scope = (strings: Record<string, string> = {}): HoleScope => ({ strings, args: {}, aliases: new Set(), page: '#090b0e' });
const draw = (template: string, strings: Record<string, string> = {}, c = ctx()) => {
  const t = compileTemplate(template, scope(strings));
  return typeof t === 'string' ? t : t.parts.map(p => (typeof p === 'string' ? p : p(c, env))).join('');
};

// 2026-11-24 15:00 in Toronto.
const NOW = Date.parse('2026-11-24T20:00:00Z');
const LOCALE = JSON.stringify({ locale: 'en', formatLocale: 'en-US', resolvedLocale: 'en-US', timeZone: 'America/Toronto', utcOffset: -300 });
beforeAll(() => setPipeClock(() => NOW));
afterAll(() => setPipeClock(undefined));

describe('paths', () => {
  test('follow record references, give list lengths and record keys, and read missing paths as empty', () => {
    expect(draw('{src.hero.events.0.sides.1.score}')).toBe('2');
    expect(draw('{src.hero.events.length}')).toBe('2');
    expect(draw('{src.hero.events.0.$key}')).toBe('event:a');
    expect(draw('{src.hero.events.5.id}|{src.nothing.at.all}|{src.hero.events.0.nope}')).toBe('||');
    expect(draw('{param.league} {state.open} {param.missing}')).toBe('nhl true ');
  });
  test('$pending and $error read the page state', () => {
    expect(draw('{src.hero.$pending} {src.live.$pending} {src.live.$error}')).toBe('true false timeout');
  });
  test('reading a record goes through the reader (so the drawing subscribes to it)', () => {
    reads.length = 0;
    draw('{src.hero.events.1.phase}');
    expect(reads).toEqual(['event:b']);
  });
  test('values draw as text: booleans, numbers, lists by length, objects as set', () => {
    expect(text(true)).toBe('true');
    expect(text(0)).toBe('0');
    expect(text([])).toBe('');
    expect(text([1, 2])).toBe('2');
    expect(text({ a: 1 })).toBe('true');
    expect(text(null)).toBe('');
    expect(walk({ a: [{ b: 1 }] }, ['a', '0', 'b'], () => undefined)).toBe(1);
    expect(walk({ a: 1 }, ['__proto__'], () => undefined)).toBeUndefined();
  });
  test('an unknown root or pipe refuses the document', () => {
    expect(() => draw('{nope.x}')).toThrow('Unknown binding');
    expect(() => draw('{env.secret}')).toThrow('Unknown binding');
    expect(() => draw('{src.hero|explode}')).toThrow('Unknown pipe');
  });
  test('env keys read the viewport and capabilities, and the skeleton ranges', () => {
    const c = ctx();
    const t = compileTemplate('{env.small}{env.wide}{env.tv}{env.canMultiview}{env.canPlay}{env.range5.length}', scope());
    expect(typeof t === 'string' ? t : t.parts.map(p => (typeof p === 'string' ? p : p(c, { ...env, canMultiview: true }))).join(''))
      .toBe('falsetruefalsetruetrue5');
  });
});

describe('pipes', () => {
  test('number, percent, upper, initials, not, count, eq, lt, first, then', () => {
    expect(draw('{src.hero.ratio|percent}')).toBe('18');
    expect(draw('{src.hero.events.0.sides.0.name|upper}')).toBe('MONTRÉAL CANADIENS');
    expect(draw('{src.hero.events.0.sides.0.name|initials}')).toBe('MC');
    expect(initials('  new-york rangers')).toBe('NY');
    expect(draw('{src.hero.count|not} {src.hero.events|not}')).toBe('true false');
    expect(draw('{src.hero.events|count} {src.nothing|count}')).toBe('2 0');
    expect(draw('{src.hero.events.0.phase|eq:live} {src.hero.events.1.phase|eq:live}')).toBe('true false');
    expect(draw('{src.hero.events|count|lt:11} {src.hero.events|count|lt:2}')).toBe('true false');
    expect(draw('{src.hero.count|first} {src.hero.ratio|first} {src.nothing|first}')).toBe('true false false');
    expect(draw('{src.hero.events.0.phase|eq:live|then:on,off}')).toBe('on');
  });
  test('a literal separator draws only before a non-empty value', () => {
    expect(draw('A{param.league| · }')).toBe('A · nhl');
    expect(draw('A{param.missing| · }')).toBe('A');
  });
  test('strings fill their {arg.*} from with:, and then: picks a string', () => {
    const strings = { watch: 'Watch on {arg.name}{arg.number| · }', on: 'Following {arg.t}', off: 'Follow {arg.t}' };
    expect(draw('{s:watch|with:name=param.league,number=src.hero.events.length}', strings)).toBe('Watch on nhl · 2');
    expect(draw('{s:watch|with:name=param.league,number=param.none}', strings)).toBe('Watch on nhl');
    expect(draw('{src.hero.count|then:s:on,s:off|with:t=param.league}', strings)).toBe('Follow nhl');
    expect(draw('{s:missing}', strings)).toBe('');
  });
  test('colour pipes: tint, readable, crest, alpha', () => {
    expect(draw('{src.hero.events.0.sides.0|tint}')).toBe('#af1e2d');
    // Too light for white text: the alternate colour.
    expect(draw('{src.hero.events.0.sides.1|tint}')).toBe('#00205b');
    expect(tint('', '')).toBe('#1d2a44');
    expect(draw('{src.hero.events.0.sides.0|crest}')).toBe('#af1e2d');
    expect(crest('', 'Leafs')).toMatch(/^hsl\(\d+, 45%, 34%\)$/);
    expect(crest('', 'Leafs')).toBe(crest('', 'Leafs'));
    // A navy on a dark page is lightened; a light colour on a light page darkened.
    expect(readable('#00205b', '#090b0e')).not.toBe('#00205b');
    expect(readable('#00205b', '#ffffff')).toBe('#00205b');
    expect(readable('#f0f0f0', '#ffffff')).toMatch(/^rgba\(/);
    expect(draw('{src.hero.events.0.sides.0.color|alpha:0.5}')).toBe('rgba(175, 30, 45, 0.5)');
  });
  test('start, day, time and date follow the viewer clock, zone and locale', () => withLocale(LOCALE, () => {
    expect(startText('2026-11-25T00:30:00Z')).toBe('7:30 PM');
    expect(startText('2026-11-25T17:00:00Z')).toBe('Tomorrow 12:00 PM');
    expect(startText('2026-11-23T23:00:00Z')).toBe('Yesterday 6:00 PM');
    expect(startText('2026-11-28T17:00:00Z')).toBe('Sat 12:00 PM');
    expect(startText('2026-12-30T17:00:00Z')).toBe('Dec 30 12:00 PM');
    expect(startText('soon')).toBe('');
    expect(dayText('2026-11-24')).toBe('Today');
    expect(dayText('2026-11-25')).toBe('Tomorrow');
    expect(dayText('2026-11-23')).toBe('Yesterday');
    expect(dayText('2026-11-26')).toBe('Thu 26');
    expect(dayText('')).toBe('');
    expect(draw('{src.t|time}', {}, ctx(page({ sources: { t: '2026-11-25T00:30:00Z' } })))).toBe('7:30 PM');
    expect(draw('{src.t|date}', {}, ctx(page({ sources: { t: '2026-11-30' } })))).toBe('Nov 30');
  }));
  test('asOf picks the newest timed item at or before the picture, else the live value', () => {
    const plays = [{ at: '2026-11-24T20:00:00Z', score: { mtl: 1 } }, { at: '2026-11-24T20:10:00Z', score: { mtl: 2 } }, { at: '2026-11-24T20:20:00Z', score: { mtl: 3 } }];
    const at = (pictureTime: string) => ctx(page({ sources: { game: { plays } }, context: { pictureTime } }));
    expect(draw('{src.game.plays|asOf:at,score.mtl}', {}, at('2026-11-24T20:15:00Z'))).toBe('2');
    expect(draw('{src.game.plays|asOf:at,score.mtl}', {}, at('2026-11-24T19:00:00Z'))).toBe('');
    // No times at all (an older plugin): the live value.
    const untimed = ctx(page({ sources: { game: { plays: [{ score: { mtl: 1 } }, { score: { mtl: 4 } }] } }, context: { pictureTime: '2026-11-24T19:00:00Z' } }));
    expect(draw('{src.game.plays|asOf:at,score.mtl}', {}, untimed)).toBe('4');
    expect(draw('{src.game.plays|asOf:at}', {}, untimed)).toBe('2');
  });
});
