import { audioCardsOf, msg, type Card, type TitleActions } from '@vela/core';
import { useVela } from '@vela/core/react';
import { BlurView } from 'expo-blur';
import { forwardRef, Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';
import { cardContextActions, supportsTitleActions, type CardContextAction, type CardPress } from '../card-context-actions';
import { placeAtPoint, placeAtRect, type Point, type Rect, type Size } from '../card-context-placement';
import { DismissScope, type Focusable } from '../escape';
import Reanimated from 'react-native-reanimated';
import { MOTION, presenceStyle } from '../presence';
import { FocusPressable } from '../focus';
import { useHost } from '../host';
import { useMultiview } from './multiview/context';
import { Glyph } from './common/controls';
import { useLook } from './common/look';

export type CardMenuAnchor = { kind: 'point'; point: Point } | { kind: 'card'; rect: Rect };
export type CardMenuOpenMode = 'pointer' | 'touch' | 'keyboard' | 'tv';

interface Props {
  card: Card;
  primary: CardPress;
  href?: string;
  anchor: CardMenuAnchor;
  mode: CardMenuOpenMode;
  opener: Focusable | null;
  continueWatching?: boolean;
  /** The card is listed as this playlist entry (music: Remove from this playlist). */
  playlistEntry?: { playlistId: string; entryId: string };
  close(): void;
}

const web = Platform.OS === 'web';
const PANEL_WIDTH = 316;

function blurTint(colour: string): 'light' | 'dark' {
  const match = /^#([\da-f]{6})/i.exec(colour);
  if (!match) return 'dark';
  const value = Number.parseInt(match[1]!, 16);
  const red = value >> 16;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return red * 0.299 + green * 0.587 + blue * 0.114 > 150 ? 'light' : 'dark';
}

function episodeLine(card: Card): string {
  if (card.kind !== 'episode' || (!card.seasonNumber && !card.episodeNumber)) return '';
  return msg('cardMenu.episodeNumber', {
    season: card.seasonNumberLabel || String(card.seasonNumber),
    episode: card.episodeNumberLabel || String(card.episodeNumber),
  });
}

function restore(target: Focusable | null): void {
  requestAnimationFrame(() => {
    if (target?.requestTVFocus) target.requestTVFocus();
    else target?.focus?.();
  });
}

async function copyLink(href: string): Promise<void> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(href);
    return;
  }
  const field = document.createElement('textarea');
  field.value = href;
  field.setAttribute('readonly', '');
  Object.assign(field.style, { position: 'fixed', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error(msg('cardMenu.copyLinkFailed'));
}

export function CardContextMenu({ card, primary, href, anchor, mode, opener, continueWatching, playlistEntry, close }: Props) {
  const host = useHost();
  const vela = useVela();
  const look = useLook();
  const [management, setManagement] = useState<TitleActions | null | undefined>(undefined);
  const [menuSize, setMenuSize] = useState<Size>({ width: PANEL_WIDTH, height: 1 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef<ComponentRef<typeof FocusPressable> | null>(null);
  const guide = useRef<Focusable | null>(null);

  useEffect(() => {
    let live = true;
    setManagement(undefined);
    if (!supportsTitleActions(card)) return () => { live = false; };
    void vela.catalogue.titleActions(card.id)
      .then(actions => { if (live) setManagement(actions); })
      .catch(() => { if (live) setManagement(null); });
    return () => { live = false; };
  }, [vela, card.id, card.kind]);

  // It opens once it has measured itself and is placed (so the motion is never spent unseen), and
  // leaves with the reverse, quicker, before it unmounts: Reanimated CSS transitions (presence.tsx),
  // on the compositor on the web and the UI thread on native, so a busy page never stutters them.
  const measured = menuSize.height > 1;
  const [leaving, setLeaving] = useState(false);
  const leave = useCallback(() => {
    if (leaving) return;
    if (look.still || Platform.isTV) { close(); return; }
    setLeaving(true);
    setTimeout(close, MOTION.quick);
  }, [leaving, look.still, close]);

  const link = web && href ? new URL(href, window.location.href).href : undefined;
  const multiview = useMultiview() !== null;
  const actions = useMemo(() => cardContextActions(card, primary, management, { continueWatching, playlists: host.env.canPlaylists, href: link, multiview, playlistEntry }), [card, primary, management, continueWatching, host.env.canPlaylists, link, multiview, playlistEntry]);
  const focusFirst = mode === 'keyboard' || mode === 'tv';
  useEffect(() => {
    if (!focusFirst || menuSize.height <= 1) return;
    const frame = requestAnimationFrame(() => {
      const target = first.current as unknown as Focusable | null;
      if (target?.requestTVFocus) target.requestTVFocus();
      else target?.focus?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusFirst, menuSize.height]);

  const viewport = { width: host.viewport.width, height: host.viewport.height };
  const placement = anchor.kind === 'point'
    ? placeAtPoint(anchor.point, menuSize, viewport)
    : placeAtRect(anchor.rect, menuSize, viewport);

  // A command that goes somewhere (a dispatch, a link) closes at once; otherwise the menu leaves.
  const dismiss = useCallback((returnFocus = true) => {
    if (returnFocus) { leave(); restore(opener); }
    else close();
  }, [close, leave, opener]);

  const run = useCallback(async (item: CardContextAction) => {
    if (busy) return;
    if (item.command.kind === 'dispatch') {
      dismiss(false);
      host.dispatch(item.command.action, item.command.arg);
      return;
    }
    if (item.command.kind === 'openLink') {
      dismiss(false);
      window.open(item.command.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (item.command.kind === 'audio') {
      const op = item.command.op;
      dismiss(false);
      const cards = await audioCardsOf(vela, card);
      if (op === 'play') vela.audio.play({ items: cards, index: 0, source: card.media?.role === 'track' ? undefined : { id: card.id, name: card.name } });
      else if (op === 'next') vela.audio.playNext(cards);
      else vela.audio.addToQueue(cards);
      return;
    }
    if (item.command.kind === 'removeEntry') {
      setBusy(true);
      await vela.playlists.removeEntry(item.command.playlistId, item.command.entryId);
      dismiss();
      return;
    }
    if (item.command.kind === 'copyLink') {
      setBusy(true);
      setError('');
      try {
        await copyLink(item.command.href);
        dismiss();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : msg('cardMenu.copyLinkFailed'));
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError('');
    try {
      await vela.catalogue.setTitleWatch(card.id, item.command.change);
      dismiss();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : msg('cardMenu.actionFailed'));
      setBusy(false);
    }
  }, [busy, card.id, dismiss, host, vela]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setMenuSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
  };
  const panelRows = {
    width: `${PANEL_WIDTH}px`,
    'max-width': 'calc(100vw - 24px)',
    'max-height': 'calc(100vh - 24px)',
    padding: '6px',
    'border-radius': '13px',
    'background-color': '$ui.popover',
    border: '1px solid $ui.glassEdge',
    'box-shadow': '0px 18px 60px $ui.shadow',
    'backdrop-filter': 'blur(22px) saturate(1.3)',
  } as const;
  const skin = `${host.doc.id} ${host.doc.name}`.toLowerCase();
  const kids = skin.includes('kids');
  const broadcast = skin.includes('broadcast');
  const radius = kids ? 20 : broadcast ? 5 : 13;
  const layer = look.layer(panelRows);
  const Trap = Platform.isTV ? TVFocusGuideView : View;
  const meta = episodeLine(card);

  return (
    <DismissScope open dismiss={leave} returnTarget={opener} guide={guide}>
      <Modal visible transparent onRequestClose={() => dismiss()} supportedOrientations={['portrait', 'landscape']}>
        <View style={StyleSheet.absoluteFill} accessibilityViewIsModal importantForAccessibility="yes" pointerEvents={leaving ? 'none' : 'auto'}>
          <FocusPressable
            style={StyleSheet.absoluteFill}
            onPress={() => dismiss()}
            accessibilityRole="button"
            accessibilityLabel={msg('ui.close')}
            focusable={false}
            testID="card-context-dismiss"
          />
          <Reanimated.View
            onLayout={onLayout}
            testID="card-context-menu"
            accessibilityRole="menu"
            accessibilityLabel={msg('cardMenu.actionsFor', { title: card.name })}
            style={[
              layer.style,
              { borderRadius: radius },
              {
                position: 'absolute', left: placement.x, top: placement.y, overflow: 'hidden',
              } as ViewStyle,
              presenceStyle(measured && !leaving, { scale: 0.96, y: -4 }, look.still || Platform.isTV, MOTION.enter, MOTION.quick),
            ]}
          >
            {layer.blur ? <BlurView intensity={Math.min(100, Math.round(layer.blur * 2.5))} tint={blurTint(look.ui.popover)} style={StyleSheet.absoluteFill} /> : null}
            <View style={{ paddingHorizontal: 12, paddingTop: 9, paddingBottom: 10, gap: 2 }}>
              <Text numberOfLines={1} style={look.text({
                'font-size': kids ? '15px' : '13px',
                'font-weight': kids ? '750' : '650',
                'letter-spacing': broadcast ? '0.06em' : '0',
                'text-transform': broadcast ? 'uppercase' : 'none',
                color: '$ui.ink',
              })}>{card.name}</Text>
              {meta ? <Text style={look.text({ 'font-size': '12px', 'font-weight': '550', color: '$ui.inkQuiet' })}>{meta}</Text> : null}
            </View>
            <View style={[look.box({ height: '1px', 'background-color': '$ui.glassEdge' }), { marginHorizontal: 6 }]} />
            <ScrollView style={{ maxHeight: Math.max(120, viewport.height - 24) }} contentContainerStyle={{ gap: 2 }} keyboardShouldPersistTaps="handled">
              <Trap
                ref={Platform.isTV ? (guide as never) : undefined}
                {...(Platform.isTV ? { autoFocus: true, trapFocusUp: true, trapFocusDown: true, trapFocusLeft: true, trapFocusRight: true } : {})}
                style={{ gap: 2 }}
              >
                {actions.map((action, index) => (
                  <Fragment key={action.id}>
                    {index > 0 && actions[index - 1]?.group !== action.group
                      ? <View style={[look.box({ height: '1px', 'background-color': '$ui.glassEdge' }), { marginHorizontal: 6, marginVertical: 4 }]} />
                      : null}
                    <MenuItem
                      ref={index === 0 ? first : undefined}
                      action={action}
                      disabled={busy}
                      radius={kids ? 14 : broadcast ? 3 : 9}
                      bold={kids}
                      run={() => void run(action)}
                    />
                  </Fragment>
                ))}
              </Trap>
              {error ? <Text accessibilityRole="alert" style={[look.text({ 'font-size': '13px', color: '$ui.accent' }), { padding: 10 }]}>{error}</Text> : null}
            </ScrollView>
          </Reanimated.View>
        </View>
      </Modal>
    </DismissScope>
  );
}

const MenuItem = forwardRef<ComponentRef<typeof FocusPressable>, {
  action: CardContextAction;
  disabled: boolean;
  radius: number;
  bold: boolean;
  run(): void;
}>(function MenuItem({ action, disabled, radius, bold, run }, ref) {
  const look = useLook();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pressed, setPressed] = useState(false);
  const highlighted = hover || focus;
  const warning = action.tone === 'warning';
  const colour = warning ? look.ui.live : look.ui.ink;
  const symbols: Record<CardContextAction['icon'], string> = {
    play: 'play-fill', restart: 'restart', info: 'info', checked: 'check-circle', unchecked: 'circle',
    external: 'external', copy: 'copy',
    heart: 'heart', 'heart-filled': 'heart-fill', bookmark: 'bookmark', 'bookmark-filled': 'bookmark-fill',
    remove: 'remove', show: 'layers', season: 'list', 'playlist-add': 'playlist-add', multiview: 'multiview',
    'play-next': 'play-next', queue: 'queue', artist: 'artist', album: 'album',
  };
  const move = (event: NativeSyntheticEvent<unknown> & { key?: string; currentTarget?: unknown }) => {
    if (!web) return;
    const key = event.key ?? (event as unknown as { nativeEvent?: { key?: string } }).nativeEvent?.key;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key ?? '')) return;
    const target = event.currentTarget as unknown as HTMLElement;
    const items = Array.from(target.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(target);
    const next = key === 'Home' ? 0 : key === 'End' ? items.length - 1 : (at + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
    (event as unknown as { preventDefault(): void; stopPropagation(): void }).preventDefault();
    (event as unknown as { preventDefault(): void; stopPropagation(): void }).stopPropagation();
  };
  return (
    <FocusPressable
      ref={ref}
      onPress={run}
      disabled={disabled}
      focusable={!disabled}
      accessibilityRole="menuitem"
      accessibilityLabel={action.label}
      accessibilityState={{ disabled }}
      testID={`card-context-${action.id}`}
      {...(web ? { onKeyDown: move as never } : {})}
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
      style={[
        look.box({
          'min-height': '40px', padding: '7px 10px', 'justify-content': 'center',
          'border-radius': `${radius}px`,
          ...(highlighted ? { 'background-color': '$ui.controlHover' } : {}),
          ...(focus ? { border: '1px solid $ui.glassEdgeStrong', 'box-shadow': '0px 0px 0px 2px $ui.accent' } : { border: '1px solid transparent' }),
        }),
        web ? ({ outlineStyle: 'none' } as unknown as ViewStyle) : null,
        pressed ? { opacity: 0.7, transform: [{ scale: 0.985 }] } : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center', opacity: warning ? 0.82 : 0.92 }}>
          <Glyph symbol={symbols[action.icon]} size={18} color={colour} />
        </View>
        <Text style={[look.text({ 'font-size': '14px', 'font-weight': bold || highlighted ? '650' : '480', color: '$ui.ink' }), warning ? { color: colour, opacity: 0.88 } : null]}>{action.label}</Text>
      </View>
    </FocusPressable>
  );
});
