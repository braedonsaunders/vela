// Ether Studio's live preview of a plugin screen (docs/plugin-screens.md; Ether's preview contract)
// and `bun tools/skin.ts serve <document>`'s multi-frame live preview for skins and built-in/page
// documents (docs/experiences.md):
//
// 1. Inside a preview frame (`?screenPreview=<token>` or `?previewDoc=<url>`):
//    - Keeps the token for the tab (`sessionStorage`), mutes playback (`setForcedMute(true)`),
//      listens for `{ type: 'vela:screen-preview:reload', screen?, page?, skin?, document? }`
//      from the parent window, preserves scroll and focus across reloads, and shows `<PreviewBadge />`.
//    - When a draft skin document is pushed or fetched from `previewDoc`, `usePreviewSkinDocument()`
//      overrides the active `SkinDocument` in place in `AppHost`.
//    - When a draft screen or built-in experience document is pushed or fetched from `previewDoc`,
//      `store.screens.reload(screen, page)` (plus an intercepted `screenDocument` draft) reloads it
//      in place without losing page state, scroll, or focus.
//
// 2. At the top-level preview host (`?preview=<url>`):
//    - Renders phone (`390x844`), tablet (`1024x768`), desktop (`1440x900`), and TV (`1920x1080`)
//      iframes side by side at fixed sizes (scaled to fit), subscribes to `<url>/__preview/events`,
//      posts `vela:screen-preview:reload` to every frame on save, and displays the validator report.
import { createElement, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, Text, View } from 'react-native';
import { msg, type Vela as Store } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { setForcedMute } from '@vela/skin/src/quiet-playback';
import { PX } from '@vela/skin/src/css';
import { formFactor } from '@vela/skin/src/resolve/screen';
import type { FormFactor, Platform as DevicePlatform, SkinDocument } from '../../../packages/protocol/skin';
import type { ScreenDocument } from '../../../packages/protocol/screen';
import { acceptReload, type PreviewReloadMessage } from './screen-preview-message';

const KEY = 'vela.screenPreview';
const PARAM = 'screenPreview';
const PREVIEW_HOST_PARAM = 'preview';
const PREVIEW_DOC_PARAM = 'previewDoc';
const PREVIEW_FRAME_PARAM = 'previewFrame';

export interface PreviewFrameSpec {
  id: 'phone' | 'tablet' | 'desktop' | 'tv';
  label: string;
  width: number;
  height: number;
  tv?: boolean;
  platform: DevicePlatform;
  form: FormFactor;
}

export const PREVIEW_FRAMES: readonly PreviewFrameSpec[] = [
  { id: 'phone', label: 'Phone', width: 390, height: 844, platform: 'ios', form: formFactor({ width: 390, height: 844 }) },
  { id: 'tablet', label: 'Tablet', width: 1024, height: 768, platform: 'ios', form: formFactor({ width: 1024, height: 768 }) },
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900, platform: 'web', form: formFactor({ width: 1440, height: 900 }) },
  { id: 'tv', label: 'TV', width: 1920, height: 1080, tv: true, platform: 'tv', form: formFactor({ width: 1920, height: 1080, tv: true }) },
] as const;

interface PreviewCheckSummary {
  ok: boolean;
  kind: 'skin' | 'screen';
  id: string;
  renderer: number;
  screen?: string;
  page?: string;
  experience?: string;
  presentation?: string;
  errors: string[];
  warnings: string[];
  findings?: { level: 'error' | 'warning'; code: string; at: string; message: string }[];
}

// Live draft document store for in-frame skin/screen overrides
let draftSkinDoc: SkinDocument | null = null;
let draftScreenDoc: ScreenDocument | null = null;
const draftListeners = new Set<() => void>();

function notifyDraftListeners(): void {
  for (const listener of draftListeners) listener();
}

export function setPreviewDraftDocument(doc: Record<string, unknown> | null | undefined): void {
  if (!doc || typeof doc !== 'object') return;
  if (doc.kind === 'screen') {
    draftScreenDoc = doc as unknown as ScreenDocument;
  } else if (doc.schema === 1 && typeof doc.id === 'string') {
    draftSkinDoc = doc as unknown as SkinDocument;
  }
  notifyDraftListeners();
}

export function getPreviewDraftSkin(): SkinDocument | null {
  return draftSkinDoc;
}

export function getPreviewDraftScreen(): ScreenDocument | null {
  return draftScreenDoc;
}

export function usePreviewSkinDocument(): SkinDocument | null {
  return useSyncExternalStore(
    listener => {
      draftListeners.add(listener);
      return () => draftListeners.delete(listener);
    },
    () => draftSkinDoc,
    () => null,
  );
}

export function usePreviewScreenDocument(): ScreenDocument | null {
  return useSyncExternalStore(
    listener => {
      draftListeners.add(listener);
      return () => draftListeners.delete(listener);
    },
    () => draftScreenDoc,
    () => null,
  );
}

/** Snapshot and restore scroll positions and active element focus across a live document reload. */
export function preserveScrollAndFocus(run: () => void | Promise<void>): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') {
    void run();
    return;
  }
  const winX = window.scrollX;
  const winY = window.scrollY;
  const scrollPositions: { el: Element; selector?: string; top: number; left: number }[] = [];
  for (const el of Array.from(document.querySelectorAll('*'))) {
    if (el.scrollTop > 0 || el.scrollLeft > 0) {
      const id = (el as HTMLElement).id;
      const testId = el.getAttribute('data-testid');
      const selector = id ? `#${CSS.escape(id)}` : testId ? `[data-testid="${CSS.escape(testId)}"]` : undefined;
      scrollPositions.push({ el, selector, top: el.scrollTop, left: el.scrollLeft });
    }
  }
  const active = document.activeElement as HTMLElement | null;
  const activeId = active?.id || '';
  const activeTestId = active?.getAttribute?.('data-testid') || '';
  const activeLabel = active?.getAttribute?.('aria-label') || '';

  const restore = () => {
    window.scrollTo(winX, winY);
    for (const item of scrollPositions) {
      const target = item.el.isConnected
        ? item.el
        : item.selector
          ? document.querySelector(item.selector)
          : null;
      if (target) {
        target.scrollTop = item.top;
        target.scrollLeft = item.left;
      }
    }
    if (active && active !== document.body) {
      let focusTarget: HTMLElement | null = active.isConnected ? active : null;
      if (!focusTarget && activeId) focusTarget = document.getElementById(activeId);
      if (!focusTarget && activeTestId) {
        focusTarget = document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(activeTestId)}"]`);
      }
      if (!focusTarget && activeLabel) {
        focusTarget = document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(activeLabel)}"]`);
      }
      focusTarget?.focus?.({ preventScroll: true });
    }
  };

  Promise.resolve(run()).finally(() => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        restore();
        requestAnimationFrame(restore);
      });
    } else {
      restore();
    }
  });
}

/** The token and preview parameters from the address, kept for the tab; and where the preview opened. */
function capture(): {
  token?: string;
  path?: string;
  previewHostUrl?: string;
  previewDocUrl?: string;
  previewFrame?: string;
} {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return {};
  const url = new URL(window.location.href);
  try {
    const previewHostUrl = url.searchParams.get(PREVIEW_HOST_PARAM) || undefined;
    const previewDocUrl = url.searchParams.get(PREVIEW_DOC_PARAM) || undefined;
    const previewFrame = url.searchParams.get(PREVIEW_FRAME_PARAM) || undefined;
    if (url.searchParams.has(PARAM)) {
      const value = url.searchParams.get(PARAM) ?? '';
      if (value) window.sessionStorage.setItem(KEY, value);
      else window.sessionStorage.removeItem(KEY);
    } else if (previewDocUrl && !window.sessionStorage.getItem(KEY)) {
      window.sessionStorage.setItem(KEY, 'preview-test');
    }
    const token = window.sessionStorage.getItem(KEY) || undefined;
    if (!url.searchParams.has(PARAM) || !token) {
      return { token, previewHostUrl, previewDocUrl, previewFrame };
    }
    // The app's own address of what Studio opened, without the base (/vela) and the token.
    url.searchParams.delete(PARAM);
    const path = url.pathname.replace(/^\/vela(?=\/)/, '') + (url.searchParams.size ? `?${url.searchParams}` : '');
    return { token, path, previewHostUrl, previewDocUrl, previewFrame };
  } catch {
    return {};
  }
}

const captured = capture();

/** The tab's preview token, or undefined outside a Studio/serve preview. */
export function previewToken(): string | undefined {
  return captured.token;
}

/** The `?preview=<url>` server URL when this tab is the top-level 4-frame preview host. */
export function previewHostUrl(): string | undefined {
  return captured.previewHostUrl;
}

/** The `?previewDoc=<url>` endpoint when this frame is driven by `tools/skin.ts serve`. */
export function previewDocUrl(): string | undefined {
  return captured.previewDocUrl;
}

/** Where to go once the #code= sign-in lands: the page Studio opened (else home). */
export function previewReturnPath(): string | undefined {
  return captured.path;
}

/** Enter preview mode before anything reads (bootstrap carries the drafts under the token). */
export function startPreview(store: Store): void {
  const token = previewToken();
  const docUrl = previewDocUrl();
  if (!token && !docUrl) return;
  setForcedMute(true);
  if (token) void store.screens.setPreview(token);
  if (docUrl && Platform.OS === 'web' && typeof fetch === 'function') {
    void fetch(`${docUrl.replace(/\/+$/, '')}/__preview/document`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(doc => {
        if (doc && typeof doc === 'object') {
          setPreviewDraftDocument(doc as Record<string, unknown>);
        }
      })
      .catch(() => {});
  }
}

/** Apply a reload message inside a preview frame while keeping scroll and focus. */
export function applyPreviewReload(store: Store, reload: PreviewReloadMessage): void {
  preserveScrollAndFocus(async () => {
    if (reload.document) {
      setPreviewDraftDocument(reload.document);
    } else if (previewDocUrl() && typeof fetch === 'function') {
      try {
        const res = await fetch(`${previewDocUrl()!.replace(/\/+$/, '')}/__preview/document`, { cache: 'no-store' });
        if (res.ok) {
          const doc = (await res.json()) as Record<string, unknown>;
          setPreviewDraftDocument(doc);
        }
      } catch {}
    }
    if (!reload.skin) {
      await store.screens.reload(reload.screen, reload.page);
    }
  });
}

/** While previewing: the console's or preview host's reload messages re-read the drafts they name. */
export function usePreviewReload(store: Store): void {
  useEffect(() => {
    if ((!previewToken() && !previewDocUrl()) || Platform.OS !== 'web' || typeof window === 'undefined' || window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      const reload = acceptReload(event, window.parent, store.screens.origin(), window.location.origin);
      if (reload) applyPreviewReload(store, reload);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [store]);
}

/** The small badge a previewing tab shows over the shell. */
export function PreviewBadge() {
  const preview = useVelaState(state => state.screens.preview);
  const draftSkin = usePreviewSkinDocument();
  const draftScreen = usePreviewScreenDocument();
  if (!previewToken() && !preview?.token && !draftSkin && !draftScreen) return null;
  return (
    <View
      pointerEvents="none"
      testID="screen-preview-badge"
      style={{
        position: 'absolute',
        left: 12 * PX,
        bottom: 12 * PX,
        zIndex: 1000,
        paddingHorizontal: 10 * PX,
        paddingVertical: 4 * PX,
        borderRadius: 999,
        backgroundColor: 'rgba(0, 0, 0, 0.72)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.35)',
      }}
    >
      <Text style={{ color: '#ffffff', fontSize: 12 * PX, fontWeight: '700', letterSpacing: 0.6 }}>
        {msg('screen.previewBadge')}
      </Text>
    </View>
  );
}

/** Choose the preview route inside each frame for a given document report. */
export function previewTargetPath(report: PreviewCheckSummary | null, currentPathname: string): string {
  if (currentPathname && currentPathname !== '/' && currentPathname !== '/vela' && currentPathname !== '/vela/') {
    return currentPathname;
  }
  if (!report) return '/';
  if (report.kind === 'screen') {
    const screen = report.screen || report.id.split('/')[0] || '';
    const page = report.page || report.id.split('/')[1] || 'index';
    if (report.experience === 'listen' || screen === 'listen') return '/library/music';
    if (screen) {
      return page && page !== 'index'
        ? `/screen/${encodeURIComponent(screen)}/${encodeURIComponent(page)}`
        : `/screen/${encodeURIComponent(screen)}`;
    }
  }
  return '/';
}

/**
 * Multi-Frame Live Preview Workspace (`/vela/?preview=<url>`):
 * Shows phone (390×844), tablet (1024×768), desktop (1440×900) and TV (1920×1080) iframes
 * side by side, reloads on save via SSE + `postMessage` (`vela:screen-preview:reload`),
 * and overlays validator findings.
 */
export function MultiFramePreviewHost({ previewUrl }: { previewUrl: string }) {
  const baseUrl = useMemo(() => {
    if (typeof window === 'undefined') return previewUrl;
    if (previewUrl === '1' || previewUrl === 'true' || previewUrl === 'self') return window.location.origin;
    try {
      return new URL(previewUrl, window.location.origin).origin + new URL(previewUrl, window.location.origin).pathname.replace(/\/+$/, '');
    } catch {
      return window.location.origin;
    }
  }, [previewUrl]);

  const [report, setReport] = useState<PreviewCheckSummary | null>(null);
  const [rev, setRev] = useState(0);
  const [connected, setConnected] = useState(false);
  const [findingsOpen, setFindingsOpen] = useState(false);
  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    let closed = false;

    const broadcastReload = (doc: Record<string, unknown> | undefined, nextReport: PreviewCheckSummary | null, nextRev: number) => {
      const payload = {
        type: 'vela:screen-preview:reload',
        ...(nextReport?.kind === 'skin' ? { skin: nextReport.id } : {}),
        ...(nextReport?.screen ? { screen: nextReport.screen } : {}),
        ...(nextReport?.page ? { page: nextReport.page } : {}),
        ...(doc ? { document: doc } : {}),
        rev: nextRev,
      };
      for (const frame of PREVIEW_FRAMES) {
        const el = iframeRefs.current[frame.id];
        try {
          el?.contentWindow?.postMessage(payload, window.location.origin);
        } catch {}
      }
    };

    // Initial fetch of report + document
    void fetch(`${baseUrl}/__preview/report`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!closed && data) setReport(data as PreviewCheckSummary);
      })
      .catch(() => {});

    // Subscribe to `/__preview/events` SSE for instant reload-on-save
    let es: EventSource | null = null;
    if (typeof EventSource !== 'undefined') {
      es = new EventSource(`${baseUrl}/__preview/events`);
      es.onopen = () => { if (!closed) setConnected(true); };
      es.onerror = () => { if (!closed) setConnected(false); };
      es.addEventListener('reload', (ev: MessageEvent) => {
        if (closed) return;
        try {
          const data = JSON.parse(String(ev.data)) as {
            rev?: number;
            document?: Record<string, unknown>;
            report?: PreviewCheckSummary;
          };
          const nextRev = data.rev ?? Date.now();
          if (data.report) setReport(data.report);
          setRev(nextRev);
          broadcastReload(data.document, data.report ?? null, nextRev);
        } catch {}
      });
    }

    return () => {
      closed = true;
      es?.close();
    };
  }, [baseUrl]);

  const targetPath = useMemo(() => {
    if (typeof window === 'undefined') return '/';
    return previewTargetPath(report, window.location.pathname);
  }, [report]);

  const findings = report?.findings ?? [];
  const errorCount = report?.errors?.length ?? 0;
  const warnCount = report?.warnings?.length ?? 0;

  return (
    <View
      testID="skin-preview-workspace"
      style={{
        flex: 1,
        backgroundColor: '#07090c',
        minHeight: '100vh' as unknown as number,
      }}
    >
      {/* Top Validator & Status Bar */}
      <View
        testID="skin-preview-header"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingVertical: 12,
          backgroundColor: '#0e1116',
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255,255,255,0.1)',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: 'rgba(220, 185, 152, 0.16)',
              borderWidth: 1,
              borderColor: 'rgba(220, 185, 152, 0.4)',
            }}
          >
            <Text style={{ color: '#dcb998', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 }}>
              VELA LIVE PREVIEW
            </Text>
          </View>
          <Text testID="skin-preview-doc-id" style={{ color: '#f5f1e9', fontSize: 15, fontWeight: '700' }}>
            {report ? `${report.id} (${report.kind}, renderer ${report.renderer})` : 'Loading document…'}
          </Text>
          <Text style={{ color: '#858d98', fontSize: 12 }}>
            {connected ? `Watching · rev ${rev}` : 'Connecting…'}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View
            testID="skin-preview-status-pill"
            onTouchEnd={() => setFindingsOpen(v => !v)}
            style={{
              cursor: 'pointer',
              paddingHorizontal: 12,
              paddingVertical: 5,
              borderRadius: 999,
              backgroundColor: report
                ? report.ok
                  ? 'rgba(76, 195, 138, 0.16)'
                  : 'rgba(232, 81, 63, 0.2)'
                : 'rgba(255,255,255,0.08)',
              borderWidth: 1,
              borderColor: report
                ? report.ok
                  ? 'rgba(76, 195, 138, 0.45)'
                  : 'rgba(232, 81, 63, 0.5)'
                : 'rgba(255,255,255,0.16)',
            }}
          >
            <Text
              onPress={() => setFindingsOpen(v => !v)}
              style={{
                color: report ? (report.ok ? '#4cc38a' : '#ff7b6b') : '#b6b8bb',
                fontSize: 12,
                fontWeight: '700',
              }}
            >
              {report
                ? `${report.ok ? 'PASS' : 'FAIL'} · ${errorCount} errors · ${warnCount} warnings`
                : 'Checking…'}
            </Text>
          </View>
        </View>
      </View>

      {/* Validator Findings Overlay Drawer */}
      {(findingsOpen || (report && !report.ok)) && findings.length > 0 ? (
        <View
          testID="skin-preview-findings"
          style={{
            backgroundColor: '#12161d',
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(255,255,255,0.12)',
            paddingHorizontal: 20,
            paddingVertical: 10,
            maxHeight: 160,
            overflow: 'scroll' as unknown as 'hidden',
            gap: 4,
          }}
        >
          {findings.slice(0, 12).map((f, idx) => (
            <View key={`${f.at}-${idx}`} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Text
                style={{
                  color: f.level === 'error' ? '#ff7b6b' : '#f5c451',
                  fontSize: 11,
                  fontWeight: '700',
                  minWidth: 42,
                }}
              >
                {f.level === 'error' ? 'FAIL' : 'WARN'}
              </Text>
              <Text style={{ color: '#dcb998', fontSize: 12, fontFamily: 'monospace' }}>{f.at}</Text>
              <Text style={{ color: '#b6b8bb', fontSize: 12 }}>{f.message}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Side-by-Side Device Frames: Phone, Tablet, Desktop, TV */}
      <View
        testID="skin-preview-frames"
        style={{
          flex: 1,
          flexDirection: 'row',
          flexWrap: 'nowrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: 16,
          gap: 14,
          overflow: 'scroll' as unknown as 'hidden',
        }}
      >
        {PREVIEW_FRAMES.map(frame => {
          const scale = frame.id === 'phone' ? 0.42 : frame.id === 'tablet' ? 0.31 : frame.id === 'desktop' ? 0.25 : 0.22;
          const scaledW = Math.round(frame.width * scale);
          const scaledH = Math.round(frame.height * scale);
          const frameUrl = `${targetPath}${targetPath.includes('?') ? '&' : '?'}screenPreview=preview-test&previewDoc=${encodeURIComponent(baseUrl)}&previewFrame=${frame.id}${frame.tv ? '&tv=1' : ''}`;

          return (
            <View
              key={frame.id}
              testID={`skin-preview-frame-${frame.id}`}
              style={{
                width: scaledW + 16,
                backgroundColor: '#10141b',
                borderRadius: 14,
                padding: 8,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.12)',
                gap: 8,
                flexShrink: 0,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: '#f5f1e9', fontSize: 13, fontWeight: '700' }}>{frame.label}</Text>
                <Text style={{ color: '#858d98', fontSize: 11 }}>
                  {frame.width}×{frame.height} · {frame.form}
                </Text>
              </View>
              <View
                style={{
                  width: scaledW,
                  height: scaledH,
                  overflow: 'hidden',
                  borderRadius: 8,
                  backgroundColor: '#090b0e',
                }}
              >
                {createElement('iframe', {
                  ref: (el: HTMLIFrameElement | null) => {
                    iframeRefs.current[frame.id] = el;
                  },
                  'data-testid': `skin-preview-iframe-${frame.id}`,
                  title: `${frame.label} preview (${frame.width}x${frame.height})`,
                  src: frameUrl,
                  width: String(frame.width),
                  height: String(frame.height),
                  style: {
                    width: `${frame.width}px`,
                    height: `${frame.height}px`,
                    border: '0',
                    transform: `scale(${scale})`,
                    transformOrigin: '0 0',
                    backgroundColor: '#090b0e',
                  },
                })}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
