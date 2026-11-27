import { expect, test } from 'bun:test';
import type { DownloadRecord } from '@vela/core';
import { watchAllowed } from '../src/watch-gate';

const completed = { status: 'completed', mediaPath: 's/v/t/media.mp4' } as DownloadRecord;
const kept = { ...completed, awaitingSignIn: true } as DownloadRecord;

test('signed in, every watch draws', () => {
  expect(watchAllowed('signed-in', false, undefined, undefined)).toBe(true);
  expect(watchAllowed('signed-in', true, 'channel', undefined)).toBe(true);
});

test('offline, only a hydrated, verified download of a plain title plays', () => {
  expect(watchAllowed('offline', true, undefined, completed)).toBe(true);
  expect(watchAllowed('offline', false, undefined, completed)).toBe(false);
  expect(watchAllowed('offline', true, 'channel', completed)).toBe(false);
  expect(watchAllowed('offline', true, undefined, { ...completed, status: 'downloading' } as DownloadRecord)).toBe(false);
  expect(watchAllowed('offline', true, undefined, undefined)).toBe(false);
});

test('signed out after a refused session, the kept download still plays', () => {
  expect(watchAllowed('signed-out', true, undefined, kept)).toBe(true);
  expect(watchAllowed('signed-out', false, undefined, kept)).toBe(false);
  expect(watchAllowed('signed-out', true, 'extra', kept)).toBe(false);
});

test('signed out otherwise, nothing plays', () => {
  expect(watchAllowed('signed-out', true, undefined, completed)).toBe(false);
  expect(watchAllowed('starting', true, undefined, kept)).toBe(false);
});
