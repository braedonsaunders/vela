import { localeContext, msg } from './i18n';

let calendar: { timeZone: string; format: Intl.DateTimeFormat } | undefined;
let shortDate: { locale: string; format: Intl.DateTimeFormat } | undefined;
let today: { timeZone: string; second: number; value: string } | undefined;

function parseDate(value?: string): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) return date;
}

/** Ether supplies a calendar date. The title is available on that day in the viewer's zone. */
export function isUnreleased(value?: string, now = new Date(), timeZone = localeContext().timeZone): boolean {
  if (!value || !parseDate(value)) return false;
  const second = Math.floor(now.getTime() / 1000);
  if (!today || today.timeZone !== timeZone || today.second !== second) {
    if (calendar?.timeZone !== timeZone) {
      calendar = { timeZone, format: new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }) };
    }
    const parts = calendar.format.formatToParts(now);
    today = { timeZone, second, value: ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-') };
  }
  return value > today.value;
}

function formatReleaseDate(value?: string): string {
  const date = parseDate(value);
  if (!date) return '';
  const locale = localeContext().formatLocale;
  if (shortDate?.locale !== locale) {
    shortDate = { locale, format: new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short', day: 'numeric' }) };
  }
  return shortDate.format.format(date);
}

export function releaseLabel(value?: string): string {
  return isUnreleased(value) ? msg('release.outOn', { date: formatReleaseDate(value) }) : '';
}

export function unreleasedMessage(value?: string): string {
  const date = formatReleaseDate(value);
  return date ? msg('release.comesOutOn', { date }) : msg('release.unreleased');
}
