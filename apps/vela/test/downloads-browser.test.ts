import { expect, test } from 'bun:test';
import { resumeValidator, resumedLength, syncOfflineShell } from '../src/data/downloads-browser';

test('OPFS resumes only a partial with a validator for the current original', () => {
  expect(resumeValidator({ etag: '"current"' }, '"current"')).toBe('"current"');
  expect(resumeValidator({ etag: '"obsolete"' }, '"current"')).toBeUndefined();
  expect(resumeValidator({ etag: 'W/"weak"' })).toBeUndefined();
  expect(resumeValidator({ lastModified: 'Thu, 26 Nov 2026 00:00:00 GMT' })).toBe('Thu, 26 Nov 2026 00:00:00 GMT');
});

test('OPFS appends only an open-ended range of the requested representation', () => {
  const partial = (range: string, etag = '"current"') =>
    new Response(null, { status: 206, headers: { 'Content-Range': range, ETag: etag } });
  expect(resumedLength(partial('bytes 32-63/64'), 32, '"current"')).toBe(64);
  expect(resumedLength(partial('bytes 31-63/64'), 32, '"current"')).toBeUndefined();
  expect(resumedLength(partial('bytes 32-62/64'), 32, '"current"')).toBeUndefined();
  expect(resumedLength(partial('bytes 32-63/64', '"changed"'), 32, '"current"')).toBeUndefined();
  expect(resumedLength(new Response(), 32, '"current"')).toBeUndefined();
});

test('stored or in-flight downloads keep the offline app shell until the last record is removed', () => {
  const calls: string[] = [];
  const shell = { prepareOffline: () => calls.push('prepare'), releaseOffline: () => calls.push('release') };
  syncOfflineShell(1, shell);
  syncOfflineShell(2, shell);
  syncOfflineShell(0, shell);
  syncOfflineShell(1);
  expect(calls).toEqual(['prepare', 'prepare', 'release']);
});
