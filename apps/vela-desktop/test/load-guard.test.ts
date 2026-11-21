import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
const { attachLoadGuard } = require('../load-guard.js');

function fixture(reloads?: number) {
  const window = new EventEmitter() as any;
  const contents = new EventEmitter() as any;
  const loads: number[] = [], logs: string[] = [];
  window.destroyed = false;
  window.isDestroyed = () => window.destroyed;
  window.webContents = contents;
  contents.getURL = () => 'vela-app://app/vela/';
  const guard = attachLoadGuard(window, { load: () => loads.push(loads.length), log: (line: string) => logs.push(line), reloads });
  const navigate = () => contents.emit('did-start-navigation', {}, 'vela-app://app/vela/', false, true);
  return { window, contents, guard, loads, logs, navigate };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a document whose preload checked in is left alone, same-document routes included', async () => {
  const f = fixture();
  f.navigate();
  f.guard.checkIn();
  f.contents.emit('did-finish-load');
  f.contents.emit('did-start-navigation', {}, 'vela-app://app/vela/sign-in', true, true);
  f.contents.emit('did-start-navigation', {}, 'https://frame.invalid/', false, false);
  f.contents.emit('did-finish-load');
  await tick();
  expect(f.loads).toEqual([]);
  expect(f.logs).toEqual([]);
});

test('a document that finishes without the preload is loaded again once, and logged', async () => {
  const f = fixture();
  f.navigate();
  f.contents.emit('did-finish-load');
  expect(f.loads).toEqual([]);
  await tick();
  expect(f.loads).toHaveLength(1);
  expect(f.logs[0]).toContain("without the shell's preload; reloading");
  // The reload also lacks it: no second reload, only a log line.
  f.navigate();
  f.contents.emit('did-finish-load');
  await tick();
  expect(f.loads).toHaveLength(1);
  expect(f.logs[1]).toContain('already reloaded once');
});

test('the previous document\'s check-in does not cover the next one', async () => {
  const f = fixture();
  f.navigate();
  f.guard.checkIn();
  f.contents.emit('did-finish-load');
  f.navigate();
  f.contents.emit('did-finish-load');
  await tick();
  expect(f.loads).toHaveLength(1);
});

test('failed main-frame loads and gone renderers recover; aborts, subframes and clean exits do not', async () => {
  const f = fixture(2);
  f.contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'vela-app://app/vela/', true);
  f.contents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'https://frame.invalid/', false);
  f.contents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
  await tick();
  expect(f.loads).toEqual([]);
  f.contents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'vela-app://app/vela/', true);
  // One failure can be reported twice (fail, then a crash of the same renderer): one reload.
  f.contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 11 });
  await tick();
  expect(f.loads).toHaveLength(1);
  f.contents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 9 });
  await tick();
  expect(f.loads).toHaveLength(2);
  expect(f.logs.join('\n')).toContain('-6 ERR_FILE_NOT_FOUND');
  expect(f.logs.join('\n')).toContain('oom');
});

test('a closed window is never reloaded, and dispose detaches', async () => {
  const f = fixture();
  f.navigate();
  f.contents.emit('did-finish-load');
  f.window.destroyed = true;
  await tick();
  expect(f.loads).toEqual([]);
  const g = fixture();
  g.guard.dispose();
  g.navigate();
  g.contents.emit('did-finish-load');
  await tick();
  expect(g.loads).toEqual([]);
});
