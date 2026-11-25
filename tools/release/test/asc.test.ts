import { describe, expect, test } from 'bun:test';
import { ApiError, retryFreshBuild } from '../asc';

const fresh = () => new ApiError(404, "POST /v1/betaGroups/g/relationships/builds: 404 The specified resource does not exist: There is no resource of type 'builds' with id 'b'");

describe('retryFreshBuild', () => {
  test('waits out a build App Store Connect does not know yet, with growing delays', async () => {
    const slept: number[] = [];
    let calls = 0;
    const result = await retryFreshBuild(async () => {
      if (++calls < 3) throw fresh();
      return 'added';
    }, { sleep: async ms => { slept.push(ms); } });
    expect(result).toBe('added');
    expect(slept).toEqual([5_000, 10_000]);
  });

  test('gives up with the last 404 after about 75 seconds of waiting', async () => {
    const slept: number[] = [];
    let calls = 0;
    const attempt = retryFreshBuild(async () => { calls++; throw fresh(); }, { sleep: async ms => { slept.push(ms); } });
    await expect(attempt).rejects.toThrow("no resource of type 'builds'");
    expect(calls).toBe(6);
    expect(slept.reduce((a, b) => a + b, 0)).toBe(75_000);
  });

  test('does not retry other errors', async () => {
    let calls = 0;
    const other = new ApiError(404, "GET /v1/apps/x: 404 There is no resource of type 'apps' with id 'x'");
    await expect(retryFreshBuild(async () => { calls++; throw other; }, { sleep: async () => {} })).rejects.toBe(other);
    await expect(retryFreshBuild(async () => { calls++; throw new ApiError(409, 'conflict'); }, { sleep: async () => {} })).rejects.toThrow('conflict');
    expect(calls).toBe(2);
  });
});
