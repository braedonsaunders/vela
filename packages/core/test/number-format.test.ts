// Small integers skip Intl where the result is the same: the fast path writes exactly what Intl writes.
import { expect, test } from 'bun:test';
import { number, percent, withLocale } from '../src/i18n';

const context = (locale: string) => JSON.stringify({ locale, formatLocale: locale, resolvedLocale: locale, timeZone: 'UTC', utcOffset: 0 });

test('small integers read as Intl writes them, in every option the fast path takes', () => {
  for (const locale of ['en', 'en-US', 'de-DE', 'fr-FR', 'ar-EG', 'hi-IN-u-nu-deva', 'fa']) {
    withLocale(context(locale), () => {
      for (const value of [0, 7, 42, 175, 999, 1000, 2026, 12345, 1234567]) {
        for (const options of [undefined, { useGrouping: false }, { minimumIntegerDigits: 2, useGrouping: false }, { maximumFractionDigits: 1 }, { maximumFractionDigits: 0 }]) {
          expect(number(value, options)).toBe(new Intl.NumberFormat(locale, options).format(value));
        }
      }
      for (const value of [-3, 1.5, 0.25]) expect(number(value)).toBe(new Intl.NumberFormat(locale).format(value));
      expect(number(5, { style: 'percent' })).toBe(new Intl.NumberFormat(locale, { style: 'percent' }).format(5));
    });
  }
  withLocale(context('en'), () => expect(percent(0.42)).toContain('42'));
});
