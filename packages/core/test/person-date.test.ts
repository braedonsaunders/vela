import { expect, test } from 'bun:test';
import { personDates } from '../src/discovery/person-date';
import { withLocale } from '../src/i18n';
const en = JSON.stringify({ locale: 'en-US', formatLocale: 'en-US', resolvedLocale: 'en', timeZone: 'America/Toronto', utcOffset: -300 });
test('person dates use calendar days and age at death or today', () => withLocale(en, () => {
  expect(personDates('1977-09-15', undefined, new Date('2026-11-17T12:00:00Z'))).toBe('Born September 15, 1977 · 49');
  expect(personDates('1977-09-15', '2020-09-14')).toBe('Born September 15, 1977 · Died September 14, 2020 · 42');
  expect(personDates('2020-02-31')).toBe('');
}));
