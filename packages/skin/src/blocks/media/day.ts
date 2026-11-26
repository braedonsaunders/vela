import { localeContext, type Card } from '@vela/core';

/** A date as the viewer reads it ("23 Nov 2026"), else the year label; '' when neither is known. */
export function dayLabel(card: Pick<Card, 'airDate' | 'yearLabel'>): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(card.airDate)) {
    const date = new Date(`${card.airDate}T00:00:00Z`);
    if (Number.isFinite(date.getTime())) {
      try { return new Intl.DateTimeFormat(localeContext().formatLocale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date); } catch { /* The year below. */ }
    }
  }
  return card.yearLabel;
}
