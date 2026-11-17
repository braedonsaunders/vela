import { expect, test } from 'bun:test';
import { deviceLocale } from '../src/i18n';

test('the default locale context is the device time zone, not UTC', () => {
  const context = deviceLocale();
  expect(context.timeZone).toBe(new Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(context.utcOffset).toBe(-new Date().getTimezoneOffset());
});
