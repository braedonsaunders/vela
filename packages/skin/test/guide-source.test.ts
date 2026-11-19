import { expect, test } from 'bun:test';
import { VelaError } from '@vela/core';
import { liveSource, type LiveAdapter } from '../src/widgets/guide/source';
import type { ClientCapabilities, PlaybackPlan, ProtocolError } from '../../protocol/types';

const failure = (code: string, status = 409) => new VelaError({ code, class: 'conflict', message: code, retry: { allowed: false } } as ProtocolError, status);
const plan = { sessionId: 'a', sourceGeneration: 1, seekGeneration: 1 } as PlaybackPlan;
function source(command: LiveAdapter['command']) {
  return liveSource({ command } as LiveAdapter, {} as ClientCapabilities);
}
test('stopping an already ended or expired session succeeds without retrying', async () => {
  for (const error of [failure('session_ended'), failure('not_found', 404), failure('expired', 410)]) {
    let calls = 0;
    await source(async () => { calls++; throw error; }).stop(plan);
    expect(calls).toBe(1);
  }
});
test('stop racing generation change accepts session ending during its retry', async () => {
  let calls = 0;
  await source(async () => {
    if (++calls === 1) throw new VelaError({ ...failure('stale_generation').detail, currentGenerations: { sourceGeneration: 2, seekGeneration: 2 } }, 409);
    throw failure('session_ended');
  }).stop(plan);
  expect(calls).toBe(2);
});
test('stop still reports real server failures', async () => {
  await expect(source(async () => { throw failure('capacity', 503); }).stop(plan)).rejects.toBeInstanceOf(VelaError);
});
