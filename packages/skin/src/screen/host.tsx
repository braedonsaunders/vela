// The host of a plugin screen or surface (docs/plugin-screens.md): reads its document (core's
// useScreenDocument), resolves it for this viewport in the active skin's look, opens its page
// (useScreenPage: data read and followed live while shown), and draws it with the skin renderer
// in a context whose holes read that page and the shared record pool. Presses inside it come
// here (SkinHost.screenPress) and become the fixed actions; what leaves the screen (opening a
// page or a route, playback, links, confirmations, toasts) is the app's (ScreenAppActions).
// Section routes, pages and W5's surface hosts all draw through ScreenView.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Text, View } from 'react-native';
import { useRecordReader, useScreenDocument, useScreenPage, useVela } from '@vela/core/react';
import { msg, screenDocumentHref, type ScreenTarget } from '@vela/core';
import type { ScreenDocument, SurfaceContext } from '../../../protocol/screen';
import type { ScreenPageState } from '../../../core/src/screens/types';
import { PX } from '../css';
import { tvPixelScale } from '../tv-pixel-scale';
import type { ScreenPress, SkinHost } from '../host';
import { fill, type RNode } from '../resolve';
import { resolveScreenDocument, type ResolvedScreen } from '../resolve/screen';
import { resolveUi } from '../resolve/ui';
import { hasFlowHeader, overlayHeaderOffset } from '../resolve/inherit';
import type { Node } from '../../../protocol/skin';
import { SkinNodeFor, SkinRoot, SkinRoute } from '../render';
import { ScreenRuntimeContext, type ScreenRuntime } from './block-view';
import { screenRoot } from './items';

/** Where a `navigate` goes: a page of a plugin screen, or one of the app's built-in routes. */
export type ScreenDestination =
  | { kind: 'page'; screen: string; page: string; href: string; params: Record<string, string>; presentation?: string }
  | { kind: 'route'; route: 'title' | 'live' | 'guide' | 'search' | 'home' | 'library'; id: string };

/** What leaves the screen: the app performs it (routes, playback, platform dialogs). */
export interface ScreenAppActions {
  navigate(to: ScreenDestination): void;
  /** The page's params changed (setParam): the route updates its address (web history replaces). */
  setParams(params: Record<string, string>): void;
  /** `{channel}`, `{programme, channel, from}` or `{item}`, through the app's watch routes. */
  play(args: Record<string, string>): void;
  /** Present only while multiview is available (env.canMultiview). */
  multiview?(channel: string): void;
  openLink(href: string): void;
  back(): void;
  confirm(text: string): Promise<boolean>;
  toast(text: string): void;
  /** Surfaces: a toast dismissing itself; tuning the context's channel or an event's target. */
  dismiss?(): void;
  watch?(args: Record<string, string>): void;
}

export interface ScreenViewProps {
  target: ScreenTarget;
  href: string;
  params?: Record<string, string>;
  context?: SurfaceContext;
  /** The app's skin host for this place (the active document, viewport, images). */
  host: SkinHost;
  /** Shown now: the page follows its live topic only while shown, and re-reads when shown again. */
  active: boolean;
  actions: ScreenAppActions;
  /** Draw as a route (the page's scroll, route focus) rather than inline (a surface). */
  route?: boolean;
  /** Drawn when the document cannot be drawn by this client (default: an "update the app" line). */
  refused?: (reason: string) => ReactNode;
}

const BOOL = /^(true|false)$/;
const patchValue = (value: string): unknown => (BOOL.test(value) ? value === 'true' : value);

/** The arguments of a press without the ones that name the action itself. */
function without(args: Record<string, string>, ...names: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(args).filter(([name]) => !names.includes(name)));
}

/** A document resolved for this viewport and skin, or why it cannot be drawn. */
function useResolved(doc: ScreenDocument | undefined, host: SkinHost): { resolved?: ResolvedScreen; problem: string } {
  const { width, height } = host.viewport;
  const ui = host.doc.document.ui;
  return useMemo(() => {
    if (!doc) return { problem: '' };
    try {
      const scale = Platform.isTV && Platform.OS === 'android' ? tvPixelScale(width, height) : PX;
      const resolved = resolveScreenDocument(doc, { width, tv: Platform.isTV, scale }, 'en', resolveUi(ui));
      if (resolved.warnings.length) console.warn(`${doc.screen}/${doc.page}: ${resolved.warnings.join('; ')}`);
      return { resolved, problem: '' };
    } catch (error) {
      return { problem: error instanceof Error ? error.message : String(error) };
    }
  }, [doc, width, height, ui]);
}

export function ScreenView({ target, href, params = {}, context, host, active, actions, route = true, refused }: ScreenViewProps) {
  const vela = useVela();
  const document = useScreenDocument(href);
  const { resolved, problem } = useResolved(document.value, host);
  const request = useMemo(() => (active ? { target, href, params, context } : undefined),
    // Params and context by value: a new object with the same entries is the same page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, href, JSON.stringify(target), JSON.stringify(params), JSON.stringify(context ?? null)]);
  const { key, page: shown } = useScreenPage(request);
  // Hidden, the page stops following its topic; what it last drew stays until it is shown again.
  const last = useRef<{ key: string; page: ScreenPageState } | null>(null);
  if (shown) last.current = { key, page: shown };
  const page = shown ?? last.current?.page;
  const pageKey = key || last.current?.key || '';
  const record = useRecordReader();
  const [state, setState] = useState<Record<string, string>>({});
  // A plugin action's answer may carry a line to show (at most 200 characters), for a few seconds.
  const [toast, setToast] = useState('');
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const ctx = useMemo(() => (page ? screenRoot(page, record, state) : undefined), [page, record, state]);

  const doc = document.value;
  const navigate = useCallback((args: Record<string, string>) => {
    if (args.route) {
      actions.navigate({ kind: 'route', route: args.route as 'title', id: args.id ?? '' });
      return;
    }
    const screen = args.screen || (target.kind === 'screen' ? target.id : '');
    const pageName = args.page || 'index';
    const nextHref = !args.screen || args.screen === screen ? screenDocumentHref(href, pageName) : '';
    actions.navigate({ kind: 'page', screen, page: pageName, href: nextHref, params: without(args, 'page', 'screen') });
  }, [actions, href, target]);

  const press = useCallback((p: ScreenPress) => {
    const args = p.args;
    const flag = args.flag ?? p.arg;
    switch (p.action) {
      case 'navigate': navigate(args); return;
      case 'setParam': {
        const name = args.name ?? '';
        if (!name || !page) return;
        const next = { ...page.params, [name]: args.value ?? '' };
        for (const cleared of (args.clear ?? '').split(',').filter(Boolean)) delete next[cleared];
        if (!next[name]) delete next[name];
        actions.setParams(next);
        return;
      }
      case 'toggle': setState(s => ({ ...s, [flag]: s[flag] === 'true' ? '' : 'true' })); return;
      case 'open': {
        // `open name=value` sets a state value (tabs bound to state); `open name` sets a flag.
        const at = flag.indexOf('=');
        if (at > 0) setState(s => ({ ...s, [flag.slice(0, at)]: flag.slice(at + 1) }));
        else setState(s => ({ ...s, [flag]: 'true' }));
        return;
      }
      case 'close': setState(s => ({ ...s, [flag]: '' })); return;
      case 'only': setState(s => (s[flag] === 'true' ? { ...s, [flag]: '' } : { ...Object.fromEntries(Object.keys(s).map(k => [k, ''])), [flag]: 'true' })); return;
      case 'play': actions.play(args); return;
      case 'multiview': if (args.channel || p.arg) actions.multiview?.(args.channel || p.arg); return;
      case 'openLink': {
        const target = args.href ?? '';
        if (!Platform.isTV && /^https:\/\//.test(target) && vela.screens.links(pageKey).has(target)) actions.openLink(target);
        return;
      }
      case 'back': actions.back(); return;
      case 'retry': void vela.screens.retry(pageKey, args.source ? [args.source] : undefined); return;
      case 'dismiss': actions.dismiss?.(); return;
      case 'watch': actions.watch?.(args); return;
      case 'plugin': {
        const name = args.name ?? '';
        if (!name || !pageKey) return;
        const confirm = doc?.actions?.[name]?.confirm;
        void (async () => {
          if (confirm && !(await actions.confirm(confirm))) return;
          const o = p.optimistic;
          try {
            const answer = await vela.screens.action(pageKey, {
              name, args: without(args, 'name'), control: p.control,
              ...(o ? { optimistic: { ...(o.record ? { record: o.record } : {}), ...(o.source ? { source: o.source } : {}), path: o.path, value: patchValue(o.value) } } : {}),
            });
            if (answer?.toast) { setToast(answer.toast.slice(0, 200)); actions.toast(answer.toast.slice(0, 200)); }
            if (answer?.navigate) navigate(answer.navigate.args as Record<string, string>);
          } catch {
            // The optimistic patch is dropped by core; the control is no longer busy.
          }
        })();
        return;
      }
      default:
        // A skin action pressed inside a screen (none in documents Ether validates).
        host.dispatch(p.action, p.arg);
    }
  }, [actions, doc, host, navigate, page, pageKey, vela]);

  const screenHost = useMemo<SkinHost>(() => ({
    ...host,
    env: { ...host.env, canMultiview: !!actions.multiview, canPlay: true },
    screenPress: press,
  }), [host, actions.multiview, press]);
  const runtime = useMemo<ScreenRuntime>(() => ({
    renderNode: (node: RNode, at) => <SkinNodeFor node={node} ctx={at} />,
    need: sources => { if (pageKey) void vela.screens.need(pageKey, sources); },
    title: resolved && ctx ? fill(resolved.title, ctx, screenHost.env) : '',
    presentation: doc?.presentation ?? 'section',
    insetTop: route && doc?.presentation === 'section' ? barOffset(host.doc.document.slots?.shell, host.viewport.width < 640, host.viewport.insets.top) * PX : 0,
  }), [pageKey, vela, resolved, ctx, screenHost.env, doc?.presentation, route, host.doc, host.viewport]);

  const reason = problem || (document.load === 'failed' ? document.error : '');
  if (reason) return <>{refused ? refused(reason) : <Refused host={host} reason={reason} />}</>;
  if (!resolved || !ctx || !page) {
    // Before the document or the first read: the document's own skeleton once it is resolved.
    return resolved ? <Draw host={screenHost} node={resolved.loading} ctx={screenRoot(LOADING, record, state)} runtime={runtime} route={route} /> : <View style={{ flex: 1 }} />;
  }
  const node = page.load === 'failed' ? resolved.failure : page.load === 'loading' ? resolved.loading : resolved.tree;
  const drawn = <Draw host={screenHost} node={node} ctx={ctx} runtime={runtime} route={route} />;
  if (!toast) return drawn;
  const ui = resolveUi(host.doc.document.ui);
  return (
    <View style={{ flex: 1 }}>
      {drawn}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 32 * PX, alignItems: 'center' }}>
        <Text testID="screen-toast" accessibilityLiveRegion="polite" style={{ maxWidth: 520 * PX, paddingHorizontal: 18 * PX, paddingVertical: 10 * PX, borderRadius: 12 * PX,
          overflow: 'hidden', backgroundColor: ui.popover, color: ui.ink, fontSize: 14 * PX, fontWeight: '600' }}>{toast}</Text>
      </View>
    </View>
  );
}

/** How far below the top a section starts when the shell's navigation floats over it (as library
 * pages start): the bar's declared height, else none for a shell whose header is in flow. */
function barOffset(shell: Node | undefined, small: boolean, insetTop: number): number {
  if (!shell || hasFlowHeader(shell)) return 0;
  const offset = overlayHeaderOffset(shell);
  const text = small ? offset.small : offset.wide;
  const px = Number(/(-?\d+(?:\.\d+)?)px/.exec(text)?.[1] ?? 0);
  return px + (text.includes('safe-area-inset-top') ? insetTop / PX : 0);
}

const LOADING: ScreenPageState = { href: '', key: '', params: {}, sources: {}, pending: {}, errors: {}, load: 'loading', rev: 0 };

function Draw({ host, node, ctx, runtime, route }: { host: SkinHost; node: RNode; ctx: ReturnType<typeof screenRoot>; runtime: ScreenRuntime; route: boolean }) {
  return (
    <ScreenRuntimeContext.Provider value={runtime}>
      {route ? <SkinRoute host={host} node={node} ctx={ctx} /> : <SkinRoot host={host} node={node} ctx={ctx} />}
    </ScreenRuntimeContext.Provider>
  );
}

/** A document this client cannot draw: a newer renderer, a block it lacks, a broken document. */
function Refused({ host, reason }: { host: SkinHost; reason: string }) {
  const ui = resolveUi(host.doc.document.ui);
  const update = /renderer|update|needs /i.test(reason);
  return (
    <View testID="screen-refused" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 * PX, gap: 10 * PX }}>
      <Text style={{ color: ui.ink, fontSize: 18 * PX, fontWeight: '700', textAlign: 'center' }}>
        {msg(update ? 'screen.updateRequired' : 'screen.unavailable')}
      </Text>
      <Text style={{ color: ui.inkQuiet, fontSize: 14 * PX, textAlign: 'center' }}>{reason}</Text>
    </View>
  );
}
