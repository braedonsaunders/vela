// The fixed pipes of a screen document's holes (docs/plugin-screens.md: Bindings). There are no
// expressions: a hole is a path and a list of these. The client keeps only what depends on the
// viewer's clock, locale or skin; every other fact arrives from Ether already derived. The rules
// are those the built-in Sports screen used (startText, dayOffset, readableTeam).
import { duration as durationText, localeContext, number as numberText, time as clockText } from '@vela/core';
import { crest, hexColour, parseColour, readable, tint, withAlpha } from './colour';
import { deref, text, type RecordReader } from './scope';

/** A value through a pipe. `read` follows record references (a side or a list may be one). */
export type Pipe = (value: unknown, read: RecordReader) => unknown;

/** The pipes a document may name, `name` or `name:<argument>`. `with:` and `then:` with string
 * keys are compiled by the hole compiler (holes.ts); `asOf:` reads the scope there too. */
export const PIPE_NAMES = ['start', 'day', 'time', 'date', 'duration', 'number', 'percent', 'upper', 'initials', 'not', 'count',
  'eq', 'lt', 'first', 'then', 'with', 'tint', 'readable', 'crest', 'alpha', 'asOf'] as const;

/** The clock pipes read (tests set it). */
let now = () => Date.now();
export function setPipeClock(clock: (() => number) | undefined): void { now = clock ?? (() => Date.now()); }

const truthy = (v: string) => !['', 'false', '0'].includes(v);

/** A timestamp from ISO text or epoch milliseconds; NaN when neither. */
function instant(value: unknown): number {
  if (typeof value === 'number') return value;
  const s = text(value);
  if (/^\d{10,}$/.test(s)) return Number(s);
  return s ? Date.parse(s) : NaN;
}

/** The calendar date (Y, M, D as a UTC day number) of an instant in the viewer's zone. */
function dayNumber(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day')) / 86_400_000;
}

/** A date-only value (`2026-11-24`) as a UTC day number, else undefined. */
function dateOnly(value: unknown): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : undefined;
}

/** Whole days from today to a value (a date or an instant), in the viewer's zone. */
export function dayOffset(value: unknown, at = now()): number | undefined {
  const { timeZone } = localeContext();
  const day = dateOnly(value) ?? (Number.isFinite(instant(value)) ? dayNumber(instant(value), timeZone) : undefined);
  return day === undefined ? undefined : Math.round(day - dayNumber(at, timeZone));
}

/** Today, Tomorrow or Yesterday in the viewer's language, capitalised. */
function relativeDay(offset: number): string {
  const word = new Intl.RelativeTimeFormat(localeContext().formatLocale, { numeric: 'auto' }).format(offset, 'day');
  return word.charAt(0).toLocaleUpperCase() + word.slice(1);
}

/** Today's startText: "7:30 PM", "Tomorrow 7:00 PM", "Sat 7:00 PM", "Nov 30 7:00 PM". */
export function startText(value: unknown): string {
  const at = instant(value);
  if (!Number.isFinite(at)) return '';
  const days = dayOffset(at)!;
  const clock = clockText(at);
  if (days === 0) return clock;
  if (days === 1 || days === -1) return `${relativeDay(days)} ${clock}`;
  const { formatLocale, timeZone } = localeContext();
  const day = new Date(at).toLocaleDateString(formatLocale, Math.abs(days) < 7 ? { weekday: 'short', timeZone } : { month: 'short', day: 'numeric', timeZone });
  return `${day} ${clock}`;
}

/** A day chip's label: Today, Tomorrow, Yesterday, else "Thu 26". */
export function dayText(value: unknown): string {
  const days = dayOffset(value);
  if (days === undefined) return '';
  if (Math.abs(days) <= 1) return relativeDay(days);
  const only = dateOnly(value);
  const { formatLocale, timeZone } = localeContext();
  // A date-only value names a calendar day, drawn as that day wherever the viewer is. The weekday
  // leads ("Thu 26"), as the chips always read, whatever order the locale's own format would give.
  const at = only !== undefined ? only * 86_400_000 : instant(value);
  const parts = new Intl.DateTimeFormat(formatLocale, { weekday: 'short', day: 'numeric', timeZone: only !== undefined ? 'UTC' : timeZone }).formatToParts(at);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')}`.trim();
}

function dateText(value: unknown): string {
  const only = dateOnly(value);
  const { formatLocale, timeZone } = localeContext();
  if (only !== undefined) return new Date(only * 86_400_000).toLocaleDateString(formatLocale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const at = instant(value);
  return Number.isFinite(at) ? new Date(at).toLocaleDateString(formatLocale, { month: 'short', day: 'numeric', timeZone }) : '';
}

/** Up to two initials of a name, upper case. */
export function initials(name: string): string {
  const words = name.trim().split(/[\s\-_.]+/).filter(Boolean);
  return words.slice(0, 2).map(w => [...w][0]!).join('').toLocaleUpperCase();
}

/** A side's (or any object's) colour fields, or a colour given as text. */
function colourOf(value: unknown, read: RecordReader): { color: string; altColor: string; name: string } {
  const v = deref(value, read);
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return { color: text(o.color), altColor: text(o.altColor), name: text(o.name) || text(o.abbr) };
  }
  return { color: text(v), altColor: '', name: '' };
}

/** A number from a value, NaN when it is not one. */
function numeric(value: unknown, read: RecordReader): number {
  const s = text(value, read);
  return s.trim() === '' ? NaN : Number(s);
}

/**
 * A pipe by its written form, or undefined when the name is not a pipe (the caller then treats the
 * text as a literal separator). `page` is the skin's page colour, for `readable`.
 */
export function pipe(spec: string, page: string): Pipe | undefined {
  const at = spec.indexOf(':');
  const name = (at < 0 ? spec : spec.slice(0, at)).trim();
  const arg = at < 0 ? '' : spec.slice(at + 1);
  switch (name) {
    case 'start': return (v, read) => startText(deref(v, read));
    case 'day': return (v, read) => dayText(deref(v, read));
    case 'time': return (v, read) => { const t = instant(deref(v, read)); return Number.isFinite(t) ? clockText(t) : ''; };
    case 'date': return (v, read) => dateText(deref(v, read));
    case 'duration': return (v, read) => { const n = numeric(v, read); return Number.isFinite(n) && n > 0 ? durationText(n) : ''; };
    case 'number': return (v, read) => { const n = numeric(v, read); return Number.isFinite(n) ? numberText(n) : ''; };
    case 'percent': return (v, read) => { const n = numeric(v, read); return Number.isFinite(n) ? String(Math.round(n * 10_000) / 100) : ''; };
    case 'upper': return (v, read) => text(v, read).toLocaleUpperCase();
    case 'initials': return (v, read) => initials(text(v, read));
    case 'not': return (v, read) => !truthy(text(v, read));
    case 'count': return (v, read) => { const list = deref(v, read); return Array.isArray(list) ? list.length : 0; };
    case 'eq': return (v, read) => text(v, read) === arg;
    case 'lt': return (v, read) => { const n = numeric(v, read); return Number.isFinite(n) && n < Number(arg); };
    case 'first': return (v, read) => text(v, read) !== '' && numeric(v, read) === 0;
    case 'then': {
      const [yes = '', no = ''] = arg.split(',');
      return (v, read) => (truthy(text(v, read)) ? yes : no);
    }
    case 'tint': return (v, read) => { const c = colourOf(v, read); return tint(normal(c.color), normal(c.altColor)); };
    case 'readable': return (v, read) => readable(normal(colourOf(v, read).color), normal(page));
    case 'crest': return (v, read) => { const c = colourOf(v, read); return crest(c.color, c.name); };
    case 'alpha': {
      const amount = Number(arg);
      if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new Error(`alpha: takes 0..1 (${arg})`);
      return (v, read) => { const c = colourOf(v, read).color; return c ? withAlpha(c, amount) : ''; };
    }
    default: return undefined;
  }
}

/** A colour as #rrggbb where it reads as one (an 8-digit page colour, `rgb()`), for the luminance rules. */
function normal(colour: string): string {
  if (!colour) return '';
  const c = parseColour(colour);
  return c && c.a >= 1 ? hexColour(c) : colour;
}
