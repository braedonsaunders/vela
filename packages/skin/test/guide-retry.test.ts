import { expect, test } from 'bun:test';
import { VelaError } from '@vela/core';
import { LiveController } from '../src/widgets/guide/controller';

function setup(status: number) {
  let reads = 0;
  const controller = new LiveController({
    scope: `initial-guide-retry-${status}-${Date.now()}`, memory: { get: () => null, set: () => {} }, openWatch: () => {},
    source: {
      channels: async () => {
        if (++reads === 1) throw new VelaError({ class: 'transient', code: 'service_unavailable', message: 'Unavailable', retry: { allowed: true } }, status);
        return { items: [], continuation: 'exhausted' as const };
      },
      guide: async q => ({ from: q.from, until: q.until, items: [], continuation: 'exhausted' }),
      tune: async () => { throw new Error('Unexpected tune'); }, stop: async () => {},
    },
  });
  const close = controller.open('guide');
  return { controller, close, reads: () => reads };
}

test('an initial transient guide failure retries without a manual action', async () => {
  const { controller, reads } = setup(503);
  try {
    await Bun.sleep(100);
    expect(controller.view().load).toBe('failed');
    await Bun.sleep(1100);
    expect(reads()).toBe(2);
    expect(controller.view().load).toBe('ready');
  } finally { controller.dispose(); }
});

test('leaving the guide cancels an initial transient retry', async () => {
  const { controller, close, reads } = setup(503);
  try {
    await Bun.sleep(100);
    close();
    await Bun.sleep(1100);
    expect(reads()).toBe(1);
  } finally { controller.dispose(); }
});

test('an initial permanent refusal does not poll the server', async () => {
  const { controller, reads } = setup(403);
  try {
    await Bun.sleep(1200);
    expect(reads()).toBe(1);
    expect(controller.view().load).toBe('failed');
  } finally { controller.dispose(); }
});
