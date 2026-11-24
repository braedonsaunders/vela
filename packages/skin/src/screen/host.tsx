// The host of a plugin screen or surface (docs/plugin-screens.md): reads its document (core's
// useScreenDocument), resolves it for this viewport in the active skin's look, opens its page
// (useScreenPage: data read and followed live while shown), and draws it with the skin renderer
// in a context whose holes read that page and the shared record pool. Presses inside it come
// here (SkinHost.screenPress) and become the fixed actions; what leaves the screen (opening a
// page or a route, playback, links, confirmations, toasts) is the app's (ScreenAppActions).
// Section routes, pages and W5's surface hosts all draw through ScreenView.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Text, View } from 'react-native';
import { useRecordReader, useScreenDocument, useScreenPage, useVela, useVelaState } from '@vela/core/react';
import { msg, screenDocumentHref, type ScreenTarget } from '@vela/core';
import type { ScreenDocument, SurfaceContext } from '../../../protocol/screen';
import type { ScreenPageState } from '../../../core/src/screens/types';
import { PX } from '../css';
import { tvPixelScale } from '../tv-pixel-scale';
import type { ScreenPress, SkinHost } from '../host';
import { fill, type RNode } from '../resolve';
import { resolveScreenDocument, type ResolvedScreen } from '../resolve/screen';
import { resolveUi } from '../resolve/ui';
import { SkinNodeFor, SkinRoot, SkinRoute } from '../render';
import { ScreenBlockRuntimeProvider, createScreenBlockRuntime, useBlockLook, type ScreenBlockRuntime } from '../blocks';
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
  /** Surfaces: the host's client-only context (chrome, pictureTime, delayed, the playing channel under a
   *  toast), read by the document's {context.*} holes but never sent to Ether nor part of the page key. */
  local?: SurfaceContext;
  /** Surfaces: nothing is drawn until the first read answers, and nothing when it fails or the
   *  document is refused (a surface that cannot draw is left out, never a skeleton or an error). */
  quiet?: boolean;
}

const BOOL = /^(true|false)$/;
/** `name=value` or `name:value`: a state value, not a flag. */
function stateValue(flag: string): [string, string] | undefined {
  const m = /^([\w-]+)[=:](.*)$/.exec(flag);
  return m ? [m[1]!, m[2]!] : undefined;
}
const patchValue = (value: unknown): unknown => (typeof value === 'string' && BOOL.test(value) ? value === 'true' : value);

/** The arguments of a press without the ones that name the action itself. */
function without(args: Record<string, string>, ...names: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(args).filter(([name]) => !names.includes(name)));
}

/** A document resolved for this viewport and skin, or why it cannot be drawn. */
function useResolved(doc: ScreenDocument | undefined, host: SkinHost): { resolved?: ResolvedScreen; problem: string } {
  const { width, height } = host.viewport;
  const ui = host.doc.document.ui;
  // The last document of this page that resolved: a newer one that cannot be drawn (a Studio draft
  // with an error) leaves it on screen instead of the failure.
  const lastGood = useRef<{ id: string; resolved: ResolvedScreen } | null>(null);
  return useMemo(() => {
    if (!doc) return { problem: '' };
    const id = `${doc.screen}/${doc.page}`;
    try {
      const scale = host.viewport.pxScale ?? (Platform.isTV && Platform.OS === 'android' ? tvPixelScale(width, height) : PX);
      const resolved = resolveScreenDocument(doc, { width, tv: Platform.isTV, scale, ...(host.viewport.pxStep ? { step: host.viewport.pxStep } : {}) }, 'en', resolveUi(ui));
      if (resolved.warnings.length) console.warn(`${id}: ${resolved.warnings.join('; ')}`);
      lastGood.current = { id, resolved };
      return { resolved, problem: '' };
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error);
      if (lastGood.current?.id === id) {
        console.warn(`${id}: the new document cannot be drawn, the last one stays: ${problem}`);
        return { resolved: lastGood.current.resolved, problem: '' };
      }
      return { problem };
    }
  }, [doc, width, height, ui, host.viewport.pxScale, host.viewport.pxStep]);
}

export function ScreenView({ target, href, params = {}, context, host, active, actions, route = true, refused, local, quiet = false }: ScreenViewProps) {
  const vela = useVela();
  const document = useScreenDocument(href);
  const previewExpired = useVelaState(state => state.screens.preview?.expired === true);
  const { resolved, problem } = useResolved(document.value, host);
  // Only the params the page declares are read (an address may carry other keys); before the
  // document is known every given param goes, so the first read does not wait for it.
  const declared = document.value?.params;
  const pageParams = declared ? Object.fromEntries(Object.entries(params).filter(([name]) => name in declared)) : params;
  const request = useMemo(() => (active ? { target, href, params: pageParams, context } : undefined),
    // Params and context by value: a new object with the same entries is the same page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, href, JSON.stringify(target), JSON.stringify(pageParams), JSON.stringify(context ?? null)]);
  const { key, page: shown } = useScreenPage(request);
  // Hidden, the page stops following its topic; what it last drew stays until it is shown again.
  const last = useRef<{ key: string; page: ScreenPageState } | null>(null);
  if (shown) last.current = { key, page: shown };
  const held = shown ?? last.current?.page;
  // The host's client-only context joins what the page was opened with (it changes without a new read).
  const page = useMemo(() => (held && local ? { ...held, context: { ...held.context, ...local } } : held),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [held, JSON.stringify(local ?? null)]);
  const pageKey = key || last.current?.key || '';
  const record = useRecordReader();
  // A section's loading and failure nodes start below a shell bar that floats over the page.
  const look = useBlockLook();
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
    // Text for the app's own actions; plugin actions get the typed values (ScreenActionArg).
    const args: Record<string, string> = Object.fromEntries(Object.entries(p.args).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]));
    const flag = args.flag ?? p.arg;
    switch (p.action) {
      case 'navigate': navigate(args); return;
      case 'setParam': {
        // `name` (documents), `param` (the tabs block) or the plain argument.
        const name = args.name || args.param || p.arg;
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
        const value = stateValue(flag);
        if (value) setState(s => ({ ...s, [value[0]]: value[1] }));
        else setState(s => ({ ...s, [flag]: 'true' }));
        return;
      }
      case 'close': setState(s => ({ ...s, [flag]: '' })); return;
      case 'only': {
        // The tabs block sets a state-bound tab as `only name:value`.
        const value = stateValue(flag);
        if (value) setState(s => ({ ...s, [value[0]]: value[1] }));
        else setState(s => (s[flag] === 'true' ? { ...s, [flag]: '' } : { ...Object.fromEntries(Object.keys(s).map(k => [k, ''])), [flag]: 'true' }));
        return;
      }
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
              name, args: Object.fromEntries(Object.entries(p.args).filter(([k]) => k !== 'name')), control: p.control,
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
    env: { ...host.env, canMultiview: !!actions.multiview, canPlay: true, isTV: Platform.isTV },
    screenPress: press,
  }), [host, actions.multiview, press]);
  const title = resolved && ctx ? fill(resolved.title, ctx, screenHost.env) : '';
  const runtime = useMemo<ScreenBlockRuntime>(() => createScreenBlockRuntime(
    (node, at) => <SkinNodeFor node={node as RNode} ctx={at} />,
    {
      requestNeeds: sources => { if (pageKey) void vela.screens.need(pageKey, sources); },
      pageTitle: title,
      presentation: doc?.presentation === 'page' ? 'page' : 'section',
    },
  ), [pageKey, vela, title, doc?.presentation]);

  // A Studio preview whose token is no longer live: one message for the whole tab (core's flag).
  if (previewExpired) return quiet ? null : <Refused host={host} reason="" expired />;
  // A document that failed to read again keeps drawing the one it had (core keeps it ready).
  const statusTop = route && document.value?.presentation === 'section' ? look.barTop : 0;
  const reason = problem || (document.load === 'failed' && !resolved ? document.error : '');
  if (reason) return <>{quiet ? null : refused ? refused(reason) : <Refused host={host} reason={reason} />}</>;
  if (quiet && (!resolved || !ctx || !page || page.load !== 'ready')) return null;
  if (!resolved || !ctx || !page) {
    // Before the document or the first read: the document's own skeleton once it is resolved.
    return resolved ? <Draw host={screenHost} node={resolved.loading} ctx={screenRoot(LOADING, record, state)} runtime={runtime} route={route} status={statusTop} /> : <View style={{ flex: 1 }} />;
  }
  // The skeleton starts below the shell's bar; the failure centres in the whole section, as the built-in Sports screen drew them.
  const status = page.load !== 'ready';
  const statusInset = page.load === 'loading' ? statusTop : 0;
  const node = page.load === 'failed' ? resolved.failure : page.load === 'loading' ? resolved.loading : resolved.tree;
  const drawn = <Draw host={screenHost} node={node} ctx={ctx} runtime={runtime} route={route} {...(status ? { status: statusInset } : {})} />;
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

const LOADING: ScreenPageState = { href: '', key: '', params: {}, sources: {}, pending: {}, errors: {}, load: 'loading', rev: 0 };

/** The page's tree (its sections scroll and keep clear of the shell themselves); or, with `status`
 * (the points to keep clear at the top), its loading or failure node filling the page below the
 * shell's bar, as the built-in Sports screen drew its skeleton and failure. */
function Draw({ host, node, ctx, runtime, route, status }: { host: SkinHost; node: RNode; ctx: ReturnType<typeof screenRoot>; runtime: ScreenBlockRuntime; route: boolean; status?: number }) {
  return (
    <ScreenBlockRuntimeProvider value={runtime}>
      {status !== undefined
        ? <View style={{ flex: 1, paddingTop: status }}><SkinRoot host={host} node={node} ctx={ctx} /></View>
        : route ? <SkinRoute host={host} node={node} ctx={ctx} /> : <SkinRoot host={host} node={node} ctx={ctx} />}
    </ScreenBlockRuntimeProvider>
  );
}

/** A document this client cannot draw: a newer renderer, a block it lacks, a broken document. */
function Refused({ host, reason, expired = false }: { host: SkinHost; reason: string; expired?: boolean }) {
  const ui = resolveUi(host.doc.document.ui);
  const update = /renderer|update|needs /i.test(reason);
  if (expired) return (
    <View testID="screen-preview-expired" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 * PX }}>
      <Text style={{ color: ui.ink, fontSize: 18 * PX, fontWeight: '700', textAlign: 'center' }}>{msg('screen.previewExpired')}</Text>
    </View>
  );
  return (
    <View testID="screen-refused" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 * PX, gap: 10 * PX }}>
      <Text style={{ color: ui.ink, fontSize: 18 * PX, fontWeight: '700', textAlign: 'center' }}>
        {msg(update ? 'screen.updateRequired' : 'screen.unavailable')}
      </Text>
      <Text style={{ color: ui.inkQuiet, fontSize: 14 * PX, textAlign: 'center' }}>{reason}</Text>
    </View>
  );
}
