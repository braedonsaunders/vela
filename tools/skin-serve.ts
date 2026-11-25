/**
 * Live preview & same-origin proxy server for Vela skin and experience/page documents:
 *
 *   bun tools/skin.ts serve <document.ts | document.json> [--port <port>] [--server <url>] [--app <url>]
 *
 * Responsibilities:
 * 1. Watches `<document>` (and any sibling files in its directory) with debounced reload-on-save.
 * 2. Serves `/__preview/document` (the latest loaded `SkinDocument` or `ScreenDocument`, with
 *    `spec.deps` populated for screen sources) and `/__preview/report` (the `DocumentCheckReport`
 *    validator report from `tools/skin-check.ts`).
 * 3. Serves `/__preview/events` (`text/event-stream`), pushing `event: reload` with `{ rev, document, report }`
 *    on initial connection and after every file save so `MultiFramePreviewHost` can broadcast
 *    `{ type: 'vela:screen-preview:reload', ... }` to Phone, Tablet, Desktop, and TV frames while
 *    preserving scroll and focus.
 * 4. Same-origin API proxy for `/vela/v0/*` (and `/__admin/*`) to `--server` (default
 *    `process.env.VELA_SERVER || 'http://127.0.0.1:7777'`), intercepting the watched `ScreenDocument`
 *    on `/vela/v0/screens/<screen>/pages/<page>/document` and ensuring its entry is present in
 *    `/vela/v0/bootstrap` navigation so both mock and real servers work seamlessly.
 * 5. Reverse-proxies non-API routes to `--app` (e.g. `http://127.0.0.1:8085`) when provided, so
 *    opening `http://127.0.0.1:<port>/?preview=self` runs the entire 4-frame preview workspace and
 *    API on a single origin.
 */
import { watch, type FSWatcher } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { analyzeLoadedDocument, loadDocument, type DocumentCheckReport } from './skin-check';
import { sourceDeps } from '../packages/core/src/screens/deps';
import type { ScreenDocument } from '../packages/protocol/screen';
import type { SkinDocument } from '../packages/protocol/skin';

export interface SkinServeOptions {
  documentPath: string;
  port?: number;
  serverUrl?: string;
  appUrl?: string;
  quiet?: boolean;
}

export interface SkinPreviewServer {
  port: number;
  url: string;
  documentPath: string;
  getState(): {
    rev: number;
    document: SkinDocument | ScreenDocument;
    report: DocumentCheckReport;
  };
  reload(): Promise<{
    rev: number;
    document: SkinDocument | ScreenDocument;
    report: DocumentCheckReport;
  }>;
  stop(): void;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Vela-Screen-Preview, Accept, Cache-Control',
  'Access-Control-Max-Age': '86400',
};

/** Populate `deps` on each screen source spec so core's parameter re-read tracking matches Ether. */
export function prepareServedDocument(doc: SkinDocument | ScreenDocument): SkinDocument | ScreenDocument {
  if ((doc as ScreenDocument).kind !== 'screen') return doc;
  const screenDoc = doc as ScreenDocument;
  const sources = Object.fromEntries(
    Object.entries(screenDoc.sources ?? {}).map(([name, spec]) => [
      name,
      { ...spec, deps: sourceDeps(spec) },
    ]),
  );
  return { ...screenDoc, sources };
}

export function parseServeArgs(args: readonly string[]): SkinServeOptions {
  let documentPath = '';
  let port = Number(process.env.VELA_PREVIEW_PORT ?? 7788);
  let serverUrl = process.env.VELA_SERVER || 'http://127.0.0.1:7777';
  let appUrl: string | undefined = process.env.VELA_APP_URL || undefined;
  let quiet = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--port' || arg === '-p') {
      const val = args[++i];
      if (!val || !Number.isFinite(Number(val))) throw new Error('Invalid --port value');
      port = Number(val);
    } else if (arg.startsWith('--port=')) {
      port = Number(arg.slice('--port='.length));
    } else if (arg === '--server' || arg === '-s') {
      const val = args[++i];
      if (!val) throw new Error('Missing --server URL');
      serverUrl = val;
    } else if (arg.startsWith('--server=')) {
      serverUrl = arg.slice('--server='.length);
    } else if (arg === '--app' || arg === '-a') {
      const val = args[++i];
      if (!val) throw new Error('Missing --app URL');
      appUrl = val;
    } else if (arg.startsWith('--app=')) {
      appUrl = arg.slice('--app='.length);
    } else if (arg === '--quiet' || arg === '-q') {
      quiet = true;
    } else if (!arg.startsWith('-') && !documentPath) {
      documentPath = arg;
    }
  }

  if (!documentPath) {
    throw new Error('Usage: bun tools/skin.ts serve <document.ts|.json> [--port <port>] [--server <url>] [--app <url>]');
  }

  return {
    documentPath: resolve(documentPath),
    port,
    serverUrl: serverUrl.replace(/\/+$/, ''),
    appUrl: appUrl ? appUrl.replace(/\/+$/, '') : undefined,
    quiet,
  };
}

/** Check whether a request path asks for the currently watched screen document. */
function matchesWatchedScreenRequest(pathname: string, doc: SkinDocument | ScreenDocument): boolean {
  if ((doc as ScreenDocument).kind !== 'screen') return false;
  const screenDoc = doc as ScreenDocument;
  const screenMatch = /^\/vela\/v0\/screens\/([^/]+)\/pages\/([^/]+)\/document$/.exec(pathname);
  if (screenMatch) {
    const reqScreen = decodeURIComponent(screenMatch[1]!);
    const reqPage = decodeURIComponent(screenMatch[2]!);
    return reqScreen === screenDoc.screen && (reqPage === screenDoc.page || (!screenDoc.page && reqPage === 'index'));
  }
  const surfaceMatch = /^\/vela\/v0\/surfaces\/([^/]+)\/document$/.exec(pathname);
  if (surfaceMatch) {
    const reqId = decodeURIComponent(surfaceMatch[1]!);
    return reqId === `${screenDoc.screen}/${screenDoc.page}` || reqId === screenDoc.screen;
  }
  return false;
}

/** Ensure a watched screen document appears in `/vela/v0/bootstrap` navigation so `/screen/<id>` resolves `entry`. */
function injectScreenIntoBootstrap(body: Record<string, unknown>, doc: SkinDocument | ScreenDocument): Record<string, unknown> {
  if ((doc as ScreenDocument).kind !== 'screen') return body;
  const screenDoc = doc as ScreenDocument;
  if (!screenDoc.screen) return body;
  const nav = Array.isArray(body.navigation) ? [...(body.navigation as Record<string, unknown>[])] : [];
  const exists = nav.some(item => item && typeof item === 'object' && item.kind === 'screen' && item.id === screenDoc.screen);
  if (!exists) {
    const page = screenDoc.page || 'index';
    nav.push({
      kind: 'screen',
      id: screenDoc.screen,
      title: typeof screenDoc.title === 'string' && !screenDoc.title.includes('{') ? screenDoc.title : screenDoc.screen,
      page,
      document: {
        href: `/vela/v0/screens/${encodeURIComponent(screenDoc.screen)}/pages/${encodeURIComponent(page)}/document`,
        renderer: screenDoc.renderer,
      },
    });
  }
  return { ...body, navigation: nav };
}

export async function startSkinPreviewServer(options: SkinServeOptions): Promise<SkinPreviewServer> {
  const absPath = resolve(options.documentPath);
  const serverBase = (options.serverUrl || 'http://127.0.0.1:7777').replace(/\/+$/, '');
  const appBase = options.appUrl ? options.appUrl.replace(/\/+$/, '') : undefined;

  let currentDoc = prepareServedDocument(await loadDocument(absPath));
  let currentReport = await analyzeLoadedDocument(currentDoc);
  let rev = 1;

  const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();

  const formatSseReload = () =>
    encoder.encode(
      `event: reload\ndata: ${JSON.stringify({
        rev,
        document: currentDoc,
        report: currentReport,
      })}\n\n`,
    );

  const broadcast = () => {
    const payload = formatSseReload();
    for (const client of sseClients) {
      try {
        client.enqueue(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  const reload = async () => {
    try {
      const nextDoc = prepareServedDocument(await loadDocument(absPath));
      const nextReport = await analyzeLoadedDocument(nextDoc);
      currentDoc = nextDoc;
      currentReport = nextReport;
      rev += 1;
      broadcast();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      currentReport = {
        ...currentReport,
        ok: false,
        errors: [msg],
        findings: [{ level: 'error', code: 'load', at: basename(absPath), message: msg }],
      };
      rev += 1;
      broadcast();
    }
    return { rev, document: currentDoc, report: currentReport };
  };

  // Watch the target document's directory for atomic editor saves as well as direct file writes
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;
  const targetBase = basename(absPath);
  try {
    watcher = watch(dirname(absPath), (_event, filename) => {
      if (filename && filename !== targetBase && !filename.endsWith('.ts') && !filename.endsWith('.json')) {
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void reload();
      }, 60);
    });
  } catch {
    // Directory watch unavailable in restricted sandbox; manual reload() still works.
  }

  const proxyRequest = async (req: Request, targetBaseUrl: string, url: URL): Promise<Response> => {
    const upstreamUrl = `${targetBaseUrl}${url.pathname}${url.search}`;
    const headers = new Headers(req.headers);
    headers.delete('host');
    headers.delete('accept-encoding');
    const init: RequestInit = {
      method: req.method,
      headers,
      redirect: 'manual',
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = await req.arrayBuffer();
    }
    const upstreamRes = await fetch(upstreamUrl, init);

    // Intercept `/vela/v0/bootstrap` when watching a screen document so its screen entry exists in navigation
    if (url.pathname === '/vela/v0/bootstrap' && upstreamRes.ok && (currentDoc as ScreenDocument).kind === 'screen') {
      try {
        const json = (await upstreamRes.json()) as Record<string, unknown>;
        const patched = injectScreenIntoBootstrap(json, currentDoc);
        return new Response(JSON.stringify(patched), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      } catch {
        // Fall through if upstream wasn't JSON
      }
    }

    const resHeaders = new Headers(upstreamRes.headers);
    resHeaders.delete('content-encoding');
    resHeaders.delete('content-length');
    resHeaders.delete('transfer-encoding');
    for (const [k, v] of Object.entries(CORS_HEADERS)) resHeaders.set(k, v);
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: resHeaders,
    });
  };

  const server = Bun.serve({
    port: options.port ?? 7788,
    idleTimeout: 255,
    async fetch(req: Request): Promise<Response> {
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      const url = new URL(req.url);

      // 1. Live preview endpoints
      if (url.pathname === '/__preview/document') {
        return new Response(JSON.stringify(currentDoc, null, 2), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }

      if (url.pathname === '/__preview/report') {
        return new Response(JSON.stringify(currentReport, null, 2), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }

      if (url.pathname === '/__preview/reload' && req.method === 'POST') {
        const state = await reload();
        return new Response(JSON.stringify(state), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }

      if (url.pathname === '/__preview/events') {
        let clientController: ReadableStreamDefaultController<Uint8Array> | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            clientController = controller;
            sseClients.add(controller);
            controller.enqueue(formatSseReload());
          },
          cancel() {
            if (clientController) sseClients.delete(clientController);
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-store',
            Connection: 'keep-alive',
          },
        });
      }

      // 2. Intercept screen document fetch if it matches the watched ScreenDocument
      if (matchesWatchedScreenRequest(url.pathname, currentDoc)) {
        return new Response(JSON.stringify(currentDoc), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }

      // 3. Same-origin API proxy to `--server` (`/vela/v0/*` and `/__admin/*`)
      if (url.pathname.startsWith('/vela/v0/') || url.pathname.startsWith('/__admin/')) {
        try {
          return await proxyRequest(req, serverBase, url);
        } catch (error) {
          return new Response(
            JSON.stringify({ error: { code: 'upstream_unavailable', message: String(error) } }),
            {
              status: 502,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
            },
          );
        }
      }

      // 4. Reverse-proxy to `--app` (Metro / Vela web app) when configured
      if (appBase) {
        try {
          return await proxyRequest(req, appBase, url);
        } catch (error) {
          return new Response(`Vela web app proxy error (${appBase}): ${String(error)}`, {
            status: 502,
            headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      }

      // 5. Helpful status page when `--app` is not configured and root is visited directly
      const origin = `http://127.0.0.1:${server.port}`;
      return new Response(
        JSON.stringify(
          {
            ok: currentReport.ok,
            rev,
            documentPath: absPath,
            id: currentReport.id,
            kind: currentReport.kind,
            previewQuery: `?preview=${encodeURIComponent(origin)}`,
            endpoints: {
              document: `${origin}/__preview/document`,
              report: `${origin}/__preview/report`,
              events: `${origin}/__preview/events`,
            },
          },
          null,
          2,
        ),
        {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    },
  });

  const actualPort = server.port ?? options.port ?? 7788;
  const serverUrl = `http://127.0.0.1:${actualPort}`;

  if (!options.quiet) {
    console.log(`Vela document preview server watching ${absPath}`);
    console.log(`  document: ${currentReport.id} (${currentReport.kind}, renderer ${currentReport.renderer})`);
    console.log(`  status:   ${currentReport.ok ? 'PASS' : 'FAIL'} (${currentReport.errors.length} errors, ${currentReport.warnings.length} warnings)`);
    console.log(`  server:   ${serverUrl} -> API ${serverBase}${appBase ? `, App ${appBase}` : ''}`);
    if (appBase) {
      console.log(`  preview:  ${serverUrl}/?preview=self`);
    } else {
      console.log(`  preview:  open Vela web with ?preview=${encodeURIComponent(serverUrl)}`);
    }
  }

  return {
    port: actualPort,
    url: serverUrl,
    documentPath: absPath,
    getState() {
      return { rev, document: currentDoc, report: currentReport };
    },
    reload,
    stop() {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher?.close();
      for (const client of sseClients) {
        try {
          client.close();
        } catch {}
      }
      sseClients.clear();
      server.stop(true);
    },
  };
}

export async function runServeCli(args: string[]): Promise<void> {
  const options = parseServeArgs(args);
  const srv = await startSkinPreviewServer(options);
  await new Promise<void>(resolvePromise => {
    const shutdown = () => {
      srv.stop();
      resolvePromise();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}
