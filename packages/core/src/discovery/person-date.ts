import { localeContext, msg, number } from '../i18n';

/** A calendar date stays on its stated day, regardless of the viewer's time zone. */
export function personDates(birthday?: string, deathday?: string, now = new Date()): string {
  const parse = (value?: string) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : undefined;
  };
  const birth = parse(birthday), death = parse(deathday);
  const format = (date: Date) => new Intl.DateTimeFormat(localeContext().formatLocale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
  const local = new Intl.DateTimeFormat('en-US', { timeZone: localeContext().timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => Number(local.find(value => value.type === type)?.value);
  const end = death ?? new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  const age = birth && end >= birth ? end.getUTCFullYear() - birth.getUTCFullYear() - (end.getUTCMonth() < birth.getUTCMonth() || end.getUTCMonth() === birth.getUTCMonth() && end.getUTCDate() < birth.getUTCDate() ? 1 : 0) : undefined;
  return [birth ? msg('person.born', { date: format(birth) }) : '', death ? msg('person.died', { date: format(death) }) : '', age === undefined ? '' : number(age)].filter(Boolean).join(' · ');
}
