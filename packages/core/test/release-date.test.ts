import { expect, test } from 'bun:test';
import { VelaError } from '../src/adapter/errors';
import { deviceLocale, withLocale } from '../src/i18n';
import { isUnreleased } from '../src/release-date';
import { finalRefusal, startRefusal, startRetry } from '../src/store/start-retry';

test('release dates are validated and compared as calendar days in the viewer zone', () => {
  const now = new Date('2026-12-11T02:00:00Z');
  expect(isUnreleased('2026-12-11', now, 'America/Toronto')).toBe(true);
  expect(isUnreleased('2026-12-11', now, 'UTC')).toBe(false);
  expect(isUnreleased('2026-12-10', now, 'America/Toronto')).toBe(false);
  expect(isUnreleased('2026-12-12', now, 'UTC')).toBe(true);
  for (const value of [undefined, '', '2027', '2027-02-29', '2027-13-01', '2027-01-01T00:00:00Z']) {
    expect(isUnreleased(value, now, 'UTC')).toBe(false);
  }
  expect(isUnreleased('2028-02-29', now, 'UTC')).toBe(true);
});

test('an unreleased title refusal has viewer-facing copy and never retries', () => {
  const error = new VelaError({ class: 'source', code: 'title_unreleased', message: 'title unreleased', retry: { allowed: false } }, 409);
  const locale = JSON.stringify({ ...deviceLocale(), locale: 'en-US', formatLocale: 'en-US', resolvedLocale: 'en' });
  withLocale(locale, () => {
    expect(startRefusal(error, '', '2026-12-11')).toEqual({
      code: 'title_unreleased', errorClass: 'source', message: 'This comes out on Dec 11',
    });
    expect(startRefusal(error).message).toBe("This hasn't been released yet");
    expect(startRefusal(error, '', '2026-02-30').message).toBe("This hasn't been released yet");
  });
  expect(startRetry(error, 0)).toBe(0);
  expect(finalRefusal(error)).toBe(true);
});
