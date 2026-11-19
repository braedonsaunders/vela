import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';

function fixture() {
  const calls: any[] = [];
  let tick: () => void = () => {};
  let cleared = false;
  const binary = {
    capabilities: () => '{"hdr":[]}',
    create: (handle: unknown) => { calls.push(['create', handle]); return 42; },
    call: (handle: unknown, op: string, json: string) => {
      calls.push([op, JSON.parse(json)]);
      return op === 'poll' ? '[{"event":"snapshot","value":{"state":"playing"}}]' : '{}';
    },
    destroy: (handle: unknown) => calls.push(['destroy', handle]),
  };
  const exports: any = {};
  runInNewContext(readFileSync(join(import.meta.dir, '../../../apps/vela-desktop/mac/host.js'), 'utf8'), {
    exports, require: (name: string) => name === 'node:path' ? require('node:path') : binary,
    process: { platform: 'darwin', env: {}, resourcesPath: '/fixture/resources' },
    setInterval: (callback: () => void) => { tick = callback; return 7; },
    clearInterval: (id: number) => { expect(id).toBe(7); cleared = true; },
  });
  return { exports, calls, tick: () => tick(), cleared: () => cleared };
}

test('Mac host forwards grants and props and stops polling/events after idempotent disposal', async () => {
  const f = fixture();
  expect(f.exports.available()).toBe(true);
  expect(await f.exports.capabilities()).toEqual({ hdr: [] });
  const events: unknown[] = [];
  const host = await f.exports.create({ window: { getNativeWindowHandle: () => 'window-handle' }, emit: (...event: unknown[]) => events.push(event) });
  host.setAccess({ origin: 'https://ether.test', headers: {}, pathPrefix: '/media/', generation: 4 });
  host.update({ plan: { revision: 3 }, command: { id: 1, type: 'pause' } });
  host.setBounds({ x: 0, y: 20, width: 640, height: 360, scaleFactor: 2 });
  f.tick();
  expect(events).toEqual([['snapshot', { state: 'playing' }]]);
  host.destroy(); host.destroy(); f.tick(); host.update({});
  expect(f.cleared()).toBe(true);
  expect(f.calls.filter(c => c[0] === 'destroy')).toHaveLength(1);
  expect(f.calls.filter(c => c[0] === 'poll')).toHaveLength(1);
  expect(f.calls.find(c => c[0] === 'access')[1].generation).toBe(4);
  expect(f.calls.find(c => c[0] === 'bounds')[1].width).toBe(640);
});
