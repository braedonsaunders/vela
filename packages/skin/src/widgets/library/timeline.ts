import type { Card } from '@vela/core';

export interface TimelineGroup {
  key: string;
  label: string;
  items: Card[];
}

interface CalendarDate { year: number; month: number; day: number }

const dateParts = new Map<string, Intl.DateTimeFormat>();
function calendarDate(value: Date, timeZone: string): CalendarDate | undefined {
  if (!Number.isFinite(value.getTime())) return undefined;
  const key = timeZone;
  let format = dateParts.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateParts.set(key, format);
  }
  const fields = Object.fromEntries(format.formatToParts(value).map(part => [part.type, part.value]));
  const year = Number(fields.year), month = Number(fields.month), day = Number(fields.day);
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day) ? { year, month, day } : undefined;
}

function releaseDate(value: string): CalendarDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const valid = new Date(Date.UTC(year, month - 1, day));
  return valid.getUTCFullYear() === year && valid.getUTCMonth() === month - 1 && valid.getUTCDate() === day ? { year, month, day } : undefined;
}

const ordinal = (value: CalendarDate) => Math.floor(Date.UTC(value.year, value.month - 1, value.day) / 86_400_000);
const keyOf = (value: CalendarDate) => `${value.year}-${String(value.month).padStart(2, '0')}`;

function bucket(value: CalendarDate | undefined, today: CalendarDate, locale: string): { key: string; label: string } {
  if (!value) return { key: 'undated', label: 'Earlier' };
  const days = ordinal(today) - ordinal(value);
  if (days <= 0) return { key: 'today', label: 'Today' };
  if (days === 1) return { key: 'yesterday', label: 'Yesterday' };
  const mondayIndex = (new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() + 6) % 7;
  if (days <= mondayIndex) return { key: 'this-week', label: 'This week' };
  if (value.year === today.year && value.month === today.month) return { key: 'earlier', label: 'Earlier' };
  return {
    key: `month:${keyOf(value)}`,
    label: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(value.year, value.month - 1, 15))),
  };
}

/** Groups an accumulated paged answer. Identity deduplication lets adjacent pages overlap safely. */
export function timelineGroups(items: Card[], now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', locale = 'en'): TimelineGroup[] {
  const today = calendarDate(now, timeZone) ?? calendarDate(now, 'UTC')!;
  const groups = new Map<string, TimelineGroup>();
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const viewed = item.lastViewedAt ? calendarDate(new Date(item.lastViewedAt), timeZone) : undefined;
    const group = bucket(viewed ?? releaseDate(item.airDate), today, locale);
    const held = groups.get(group.key);
    if (held) held.items.push(item);
    else groups.set(group.key, { ...group, items: [item] });
  }
  return [...groups.values()];
}

export function watchedTime(value: string, now = new Date(), locale = 'en'): string {
  const then = new Date(value);
  const delta = then.getTime() - now.getTime();
  if (!Number.isFinite(delta)) return '';
  const absolute = Math.abs(delta);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (absolute < 60 * 60_000) return relative.format(Math.round(delta / 60_000), 'minute');
  if (absolute < 7 * 86_400_000) return relative.format(Math.round(delta / 3_600_000), 'hour');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(then);
}
