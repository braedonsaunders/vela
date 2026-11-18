import { expect, test } from 'bun:test';
import { clock, minute, number, time, withLocale } from '../src/i18n';

test('formatter reuse preserves locale, time zone, and numeric option boundaries', () => {
  const at = Date.UTC(2026, 10, 18, 12);
  for (const [formatLocale, timeZone] of [['en-US', 'UTC'], ['fr-FR', 'Europe/Paris'], ['en-US', 'UTC']] as const) {
    withLocale(JSON.stringify({ locale: 'en', resolvedLocale: 'en', formatLocale, timeZone, utcOffset: 0 }), () => {
      expect(time(at)).toBe(new Intl.DateTimeFormat(formatLocale, { timeZone, hour: 'numeric', minute: '2-digit' }).format(at));
      expect(number(1234.5)).toBe(new Intl.NumberFormat(formatLocale).format(1234.5));
      expect(number(1234.5, { useGrouping: false })).toBe(new Intl.NumberFormat(formatLocale, { useGrouping: false }).format(1234.5));
      expect(minute(2)).toContain('2');
      expect(clock(65)).toBe('1:05');
    });
  }
});

test('dense guide clock formatting does not construct a formatter per programme', () => {
  const original = Intl.DateTimeFormat;
  let constructions = 0;
  Intl.DateTimeFormat = new Proxy(original, { construct(target, args) { constructions++; return Reflect.construct(target, args); } });
  try {
    for (let i = 0; i < 1000; i++) time(Date.UTC(2026, 10, 18) + i * 60000);
    expect(constructions).toBeLessThanOrEqual(1);
  } finally { Intl.DateTimeFormat = original; }
});
