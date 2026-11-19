import { test, expect } from 'bun:test';
import { ReadRetryBudget, transientReadFailure } from '../web/engine/read-retry';
test('read failures retry without admitting fatal media or authorization errors', () => {
  for (const message of ['MEDIA_ERR_NETWORK', 'PIPELINE_ERROR_READ: FFmpegDemuxer: data source error', 'Playback stalled for 30 seconds', 'HTTP 503']) expect(transientReadFailure(message)).toBe(true);
  for (const message of ['HTTP 401', 'HTTP 403', 'HTTP 404', 'Video decode failed', 'unsupported codec']) expect(transientReadFailure(message, 'network')).toBe(false);
});
test('retry delays and opening time stay within sixty seconds', () => {
  const budget = new ReadRetryBudget('source');
  let now = 0;
  const waits: number[] = [];
  for (let wait; (wait = budget.next(now)) !== null;) { waits.push(wait); now += wait; }
  expect(waits).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  expect(now).toBe(60000);
  const slow = new ReadRetryBudget('slow');
  expect(slow.next(0)).toBe(1000);
  expect(slow.next(59000)).toBeNull();
});

test('stable playback earns a fresh interruption budget', () => {
  const budget = new ReadRetryBudget('source');
  expect(budget.next(0)).toBe(1000);
  budget.progress(2000);
  budget.progress(12000);
  expect(budget.next(70000)).toBe(1000);
});
