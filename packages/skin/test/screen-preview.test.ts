// Ether Studio's reload message is accepted only from the framing window at the connected origin
// (or the local `tools/skin.ts serve` multi-frame preview host), and `tools/skin-serve.ts` serves
// `/__preview/document`, `/__preview/report`, `/__preview/events` (SSE), and same-origin `/vela/v0/*`.
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { acceptReload } from '../../../apps/vela/src/screen-preview-message';
import { parseServeArgs, prepareServedDocument, startSkinPreviewServer } from '../../../tools/skin-serve';
import { formFactor } from '../src/resolve/screen';
import type { ScreenDocument } from '../../protocol/screen';

const parent = {};
const origin = 'https://ether.example';
const message = (data: unknown, extra: Partial<{ source: unknown; origin: string }> = {}) => ({ source: parent, origin, data, ...extra });

test('a reload from the parent at the Ether origin names its screen and page', () => {
  expect(acceptReload(message({ type: 'vela:screen-preview:reload', screen: 'sports', page: 'game' }), parent, origin)).toEqual({ screen: 'sports', page: 'game' });
  expect(acceptReload(message({ type: 'vela:screen-preview:reload' }), parent, origin)).toEqual({ screen: undefined, page: undefined });
});

test('a reload from the local preview host carries skin, document and rev', () => {
  const localOrigin = 'http://127.0.0.1:7788';
  const draft = { schema: 1, id: 'cinematic-doc' };
  expect(
    acceptReload(
      message({ type: 'vela:screen-preview:reload', skin: 'cinematic-doc', document: draft, rev: 3 }, { origin: localOrigin }),
      parent,
      origin,
      localOrigin,
    ),
  ).toEqual({
    screen: undefined,
    page: undefined,
    skin: 'cinematic-doc',
    document: draft,
    rev: 3,
  });
});

test('any other window, origin or message is ignored', () => {
  expect(acceptReload(message({ type: 'vela:screen-preview:reload' }, { source: {} }), parent, origin)).toBeUndefined();
  expect(acceptReload(message({ type: 'vela:screen-preview:reload' }, { origin: 'https://evil.example' }), parent, origin)).toBeUndefined();
  expect(acceptReload(message({ type: 'vela:screen-preview:reload' }), parent, undefined)).toBeUndefined();
  expect(acceptReload(message({ type: 'other' }), parent, origin)).toBeUndefined();
  expect(acceptReload(message('vela:screen-preview:reload'), parent, origin)).toBeUndefined();
  expect(acceptReload(message({ type: 'vela:screen-preview:reload', screen: 3 }), parent, origin)).toEqual({ screen: undefined, page: undefined });
});

describe('tools/skin-serve (bun tools/skin.ts serve)', () => {
  const root = resolve(import.meta.dir, '../../..');

  test('parseServeArgs parses documentPath, --port, --server, and --app', () => {
    const parsed = parseServeArgs([
      'packages/protocol/fixtures/skins/cinematic.ts',
      '--port',
      '7799',
      '--server=http://127.0.0.1:7777/',
      '--app',
      'http://127.0.0.1:8085/',
    ]);
    expect(parsed.documentPath).toBe(join(root, 'packages/protocol/fixtures/skins/cinematic.ts'));
    expect(parsed.port).toBe(7799);
    expect(parsed.serverUrl).toBe('http://127.0.0.1:7777');
    expect(parsed.appUrl).toBe('http://127.0.0.1:8085');
  });

  test('device frame viewports resolve to expected formFactor (small, wide, tv)', () => {
    expect(formFactor({ width: 390, height: 844 })).toBe('small');
    expect(formFactor({ width: 1024, height: 768 })).toBe('wide');
    expect(formFactor({ width: 1440, height: 900 })).toBe('wide');
    expect(formFactor({ width: 1920, height: 1080, tv: true })).toBe('tv');
  });

  test('prepareServedDocument populates source deps for screen documents', () => {
    const prepared = prepareServedDocument({
      schema: 1,
      kind: 'screen',
      renderer: 20,
      screen: 'news',
      page: 'index',
      version: '1.0.0',
      title: 'News',
      presentation: 'section',
      sources: {
        feed: { from: 'news.feed', topic: '{param.topic}', region: '{param.region}' },
      },
      tree: { type: 'box' },
    }) as ScreenDocument;
    expect(prepared.sources.feed?.deps).toEqual(['topic', 'region']);
  });

  test('serves /__preview/document, /__preview/report, /__preview/events, and live reloads on edit', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'vela-skin-serve-'));
    const docFile = join(tempDir, 'news.json');
    const initialDoc = {
      schema: 1,
      kind: 'screen',
      renderer: 19,
      screen: 'news',
      page: 'index',
      version: '1.0.0',
      title: 'Initial News',
      presentation: 'section',
      sources: {},
      tree: {
        type: 'box',
        style: { padding: '16px' },
        children: [{ type: 'text', text: 'Headline 1' }],
      },
    };
    await writeFile(docFile, JSON.stringify(initialDoc, null, 2), 'utf8');

    const srv = await startSkinPreviewServer({
      documentPath: docFile,
      port: 0,
      quiet: true,
    });

    try {
      // 1. Check /__preview/document
      const docRes = await fetch(`${srv.url}/__preview/document`);
      expect(docRes.status).toBe(200);
      const servedDoc = (await docRes.json()) as { title: string };
      expect(servedDoc.title).toBe('Initial News');

      // 2. Check /__preview/report
      const repRes = await fetch(`${srv.url}/__preview/report`);
      expect(repRes.status).toBe(200);
      const report = (await repRes.json()) as { ok: boolean; id: string; kind: string };
      expect(report.ok).toBe(true);
      expect(report.id).toBe('news/index');
      expect(report.kind).toBe('screen');

      // 3. Check intercepted /vela/v0/screens/news/pages/index/document
      const screenEndpointRes = await fetch(`${srv.url}/vela/v0/screens/news/pages/index/document`);
      expect(screenEndpointRes.status).toBe(200);
      const intercepted = (await screenEndpointRes.json()) as { title: string };
      expect(intercepted.title).toBe('Initial News');

      // 4. Modify the file and trigger reload
      const updatedDoc = { ...initialDoc, title: 'Updated Live News' };
      await writeFile(docFile, JSON.stringify(updatedDoc, null, 2), 'utf8');
      const state = await srv.reload();
      expect(state.rev).toBeGreaterThanOrEqual(2);
      expect((state.document as { title: string }).title).toBe('Updated Live News');

      const docRes2 = await fetch(`${srv.url}/__preview/document`);
      const servedDoc2 = (await docRes2.json()) as { title: string };
      expect(servedDoc2.title).toBe('Updated Live News');
    } finally {
      srv.stop();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
