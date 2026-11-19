import { expect, test } from 'bun:test';
import { logoIdentity } from '../src/widgets/guide/logo';

test('recycled channel images reset on channel, URL, and missing-logo changes', () => {
  expect(logoIdentity('fox', '/fox')).not.toBe(logoIdentity('tlc', '/tlc'));
  expect(logoIdentity('fox', '/old')).not.toBe(logoIdentity('fox', '/new'));
  expect(logoIdentity('fox', '/fox')).not.toBe(logoIdentity('fox', ''));
  expect(logoIdentity('one', '/shared')).not.toBe(logoIdentity('two', '/shared'));
  expect(logoIdentity('a|b', 'c')).not.toBe(logoIdentity('a', 'b|c'));
  expect(logoIdentity('fox', '/fox')).toBe(logoIdentity('fox', '/fox'));
});
