import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHANNEL_TONES, toneGraph } from '../scripts/make-format-matrix';
import { launchMock, type RunningMock } from './launch';

let mock: RunningMock;
let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'vela-formats-'));
  mock = await launchMock({ VELA_MOCK_FORMATS_ROOT: root });
});
afterAll(async () => {
  await mock.stop();
  await rm(root, { recursive: true, force: true });
});

const select = (name: unknown) =>
  fetch(`${mock.url}/__admin/original`, { method: 'POST', body: JSON.stringify({ name }) });

test('the original fixture is chosen by a plain file name that exists', async () => {
  expect((await select('../main.ts')).status).toBe(400);
  expect((await select('clip.exe')).status).toBe(400);
  expect((await select('absent.mkv')).status).toBe(404);
  const cleared = await select(null);
  expect(cleared.status).toBe(200);
  expect((await cleared.json()).name).toBeNull();
});

test('every channel of a tone layout has its own frequency', () => {
  const graph = toneGraph('7.1', 48000, 30);
  expect(graph).toContain('channel_layout=7.1');
  const frequencies = [...graph.matchAll(/frequency=(\d+)/g)].map((match) => Number(match[1]));
  expect(frequencies).toHaveLength(8);
  expect(new Set(frequencies).size).toBe(8);
  expect(frequencies[3]).toBe(CHANNEL_TONES.LFE);
  expect(graph.endsWith('[a]')).toBe(true);
});
