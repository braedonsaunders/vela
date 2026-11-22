// A multiview tile's replan reaches the server as its own session command, and only on a server
// that offers it.
import { expect, test } from 'bun:test';
import { sendCommand } from '../src/adapter/commands';
import type { ServerAdapter } from '../src/adapter';
import type * as V from '../src/wire';

const command = { kind: 'replan', maxHeight: 2160, sourceGeneration: 1, seekGeneration: 0, idempotencyKey: 'k' } as const;

test('a replan goes to replanTile with the session and height', async () => {
  const sent: unknown[] = [];
  const adapter = { command: async () => { throw new Error('not transport'); }, replanTile: async (sessionId: string, c: unknown) => { sent.push([sessionId, c]); return { sessionId, revision: 2 } as unknown as V.PlaybackPlan; } } as unknown as ServerAdapter;
  const plan = await sendCommand(adapter, 's1', command);
  expect(plan.revision).toBe(2);
  expect(sent).toEqual([['s1', command]]);
});

test('a server without tile replans says so instead of sending a transport command', async () => {
  const adapter = { command: async () => ({}) } as unknown as ServerAdapter;
  await expect(sendCommand(adapter, 's1', command)).rejects.toThrow();
});
