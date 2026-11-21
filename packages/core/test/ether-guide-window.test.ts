import { afterEach, expect, test } from 'bun:test';
import { EtherAdapter } from '../src/adapter/ether';
import type { GuideWindowRequest } from '../src/wire';
import { FakeCredentials, restoreFetch, routeFetch, type Seen } from './helpers';
afterEach(restoreFetch);
const query: GuideWindowRequest = { channelIds: ['one'], from: '2026-11-18T12:00:00Z', until: '2026-11-18T15:00:00Z' };

test('old servers do not receive bulk guide requests without an advertised capability', async () => {
  const seen = routeFetch({ 'GET /vela/v0/capabilities': {} });
  const adapter = new EtherAdapter('https://ether.example', new FakeCredentials(), 'web');
  await adapter.describe();
  expect(await adapter.guideWindow(query)).toBeNull();
  expect(seen).toHaveLength(1);
});

test('bootstrap advertises bulk reads and different POST bodies never share URL-only cached answers', async () => {
  const seen = routeFetch({
    'GET /vela/v0/bootstrap': { capabilities: { liveGuideWindow: { maxChannels: 128, maxWindowMinutes: 180 } }, rows: [] },
    'POST /vela/v0/live/guide/window': (request: Seen) => {
      if (request.headers.get('If-None-Match') === '"shared-source-revision"') return new Response(null, { status: 304 });
      const body = request.body as GuideWindowRequest;
      return Response.json({ ...body, revision: body.from, validUntil: '2026-11-18T16:00:00Z', channels: body.channelIds.map(channelId => ({ channelId, state: 'ready', programmes: [] })) }, { headers: { ETag: '"shared-source-revision"' } });
    },
  });
  const adapter = new EtherAdapter('https://ether.example', new FakeCredentials(), 'web');
  await adapter.home();
  const first = await adapter.guideWindow(query);
  expect(first?.from).toBe(query.from);
  const next = { ...query, from: '2026-11-18T15:00:00Z', until: '2026-11-18T18:00:00Z' };
  expect((await adapter.guideWindow(next))?.from).toBe(next.from);
  expect(await adapter.guideWindow(query)).toBe(first);
  expect(seen.slice(1).map(call => call.body)).toEqual([query, next, query]);
  expect(seen.slice(1, 3).every(call => !call.headers.has('If-None-Match'))).toBe(true);
  expect(seen[3]?.headers.get('If-None-Match')).toBe('"shared-source-revision"');
  adapter.resetOptionalCapabilities();
  expect(await adapter.guideWindow(query)).toBeNull();
});

test('capability reads made together while a page loads share one request', async () => {
  const seen = routeFetch({ 'GET /vela/v0/capabilities': {} });
  const adapter = new EtherAdapter('https://ether.example', new FakeCredentials(), 'web');
  await Promise.all([adapter.describe(), adapter.describe()]);
  await adapter.describe();
  expect(seen).toHaveLength(1);
});
