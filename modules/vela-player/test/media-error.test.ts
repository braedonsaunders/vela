import { expect, test } from 'bun:test';
import { redactMediaError } from '../src/media-error';

test('native media diagnostics omit query credentials and authorization fields', () => {
  const text = redactMediaError('AVPlayer failed at https://media.example/stream.m3u8?api_key=jelly-secret&X-Plex-Token=plex-secret#private Authorization: Bearer header-secret');
  expect(text).toContain('https://media.example/stream.m3u8');
  for (const secret of ['jelly-secret', 'plex-secret', 'header-secret', '?api_key', '#private']) expect(text).not.toContain(secret);
});
