import { msg, type Card, type TitleActions } from '@vela/core';
import { useVela } from '@vela/core/react';
import { BlurView } from 'expo-blur';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  Animated,
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
import { FocusPressable } from '../focus';
import { useHost } from '../host';
import { useLook } from './common/look';

export type CardMenuAnchor = { kind: 'point'; point: Point } | { kind: 'card'; rect: Rect };
export type CardMenuOpenMode = 'pointer' | 'touch' | 'keyboard' | 'tv';

interface Props {
  card: Card;
  primary: CardPress;
  anchor: CardMenuAnchor;
  mode: CardMenuOpenMode;
  opener: Focusable | null;
  continueWatching?: boolean;
  close(): void;
}

const web = Platform.OS === 'web';
const PANEL_WIDTH = 300;

function restore(target: Focusable | null): void {
  requestAnimationFrame(() => {
    if (target?.requestTVFocus) target.requestTVFocus();
    else target?.focus?.();
  });
}

export function CardContextMenu({ card, primary, anchor, mode, opener, continueWatching, close }: Props) {
  const host = useHost();
  const vela = useVela();
  const look = useLook();
  const [management, setManagement] = useState<TitleActions | null | undefined>(undefined);
  const [menuSize, setMenuSize] = useState<Size>({ width: PANEL_WIDTH, height: 1 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef<ComponentRef<typeof FocusPressable> | null>(null);
  const guide = useRef<Focusable | null>(null);
  const openValue = useRef(new Animated.Value(look.still ? 1 : 0)).current;

  useEffect(() => {
    let live = true;
    setManagement(undefined);
    if (!supportsTitleActions(card)) return () => { live = false; };
    void vela.catalogue.titleActions(card.id)
      .then(actions => { if (live) setManagement(actions); })
      .catch(() => { if (live) setManagement(null); });
    return () => { live = false; };
  }, [vela, card.id, card.kind]);

  useEffect(() => {
    if (look.still) { openValue.setValue(1); return; }
    Animated.spring(openValue, { toValue: 1, damping: 22, stiffness: 320, mass: 0.7, useNativeDriver: true }).start();
  }, [look.still, openValue]);

  const actions = useMemo(() => cardContextActions(card, primary, management, { continueWatching, playlists: host.env.canPlaylists }), [card, primary, management, continueWatching, host.env.canPlaylists]);
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

  const dismiss = useCallback((returnFocus = true) => {
    close();
    if (returnFocus) restore(opener);
  }, [close, opener]);

  const run = useCallback(async (item: CardContextAction) => {
    if (busy) return;
    if (item.command.kind === 'dispatch') {
      dismiss(false);
      host.dispatch(item.command.action, item.command.arg);
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
    padding: '7px',
    'border-radius': '$ui.radiusPanel',
    'background-color': '$ui.popover',
    border: '1px solid $ui.glassEdge',
    'box-shadow': '0px 18px 60px $ui.shadow',
    'backdrop-filter': 'blur(22px) saturate(1.3)',
  } as const;
  const layer = look.layer(panelRows);
  const Trap = Platform.isTV ? TVFocusGuideView : View;
  const scale = openValue.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });
  const hidden = menuSize.height <= 1;

  return (
    <DismissScope open dismiss={close} returnTarget={opener} guide={guide}>
      <Modal visible transparent onRequestClose={() => dismiss()} supportedOrientations={['portrait', 'landscape']}>
        <View style={StyleSheet.absoluteFill} accessibilityViewIsModal importantForAccessibility="yes">
          <FocusPressable
            style={StyleSheet.absoluteFill}
            onPress={() => dismiss()}
            accessibilityRole="button"
            accessibilityLabel={msg('ui.close')}
            focusable={false}
            testID="card-context-dismiss"
          />
          <Animated.View
            onLayout={onLayout}
            testID="card-context-menu"
            accessibilityRole="menu"
            accessibilityLabel={msg('cardMenu.actionsFor', { title: card.name })}
            style={[
              layer.style,
              {
                position: 'absolute', left: placement.x, top: placement.y, overflow: 'hidden',
                opacity: hidden ? 0 : openValue, transform: [{ scale }],
              } as ViewStyle,
            ]}
          >
            {layer.blur ? <BlurView intensity={Math.min(100, Math.round(layer.blur * 2.5))} tint="dark" style={StyleSheet.absoluteFill} /> : null}
            <ScrollView style={{ maxHeight: Math.max(120, viewport.height - 24) }} contentContainerStyle={{ gap: 2 }} keyboardShouldPersistTaps="handled">
              <Trap
                ref={Platform.isTV ? (guide as never) : undefined}
                {...(Platform.isTV ? { autoFocus: true, trapFocusUp: true, trapFocusDown: true, trapFocusLeft: true, trapFocusRight: true } : {})}
                style={{ gap: 2 }}
              >
                {actions.map((action, index) => (
                  <MenuItem
                    key={action.id}
                    ref={index === 0 ? first : undefined}
                    action={action}
                    disabled={busy}
                    run={() => void run(action)}
                  />
                ))}
              </Trap>
              {error ? <Text accessibilityRole="alert" style={[look.text({ 'font-size': '13px', color: '$ui.accent' }), { padding: 10 }]}>{error}</Text> : null}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </DismissScope>
  );
}

const MenuItem = forwardRef<ComponentRef<typeof FocusPressable>, {
  action: CardContextAction;
  disabled: boolean;
  run(): void;
}>(function MenuItem({ action, disabled, run }, ref) {
  const look = useLook();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pressed, setPressed] = useState(false);
  const highlighted = hover || focus;
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
          'min-height': '42px', padding: '9px 11px', 'justify-content': 'center',
          'border-radius': '10px',
          ...(highlighted ? { 'background-color': '$ui.controlHover' } : {}),
          ...(focus ? { border: '1px solid $ui.glassEdgeStrong', 'box-shadow': '0px 0px 0px 2px $ui.accent' } : { border: '1px solid transparent' }),
        }),
        web ? ({ outlineStyle: 'none' } as unknown as ViewStyle) : null,
        pressed ? { opacity: 0.7, transform: [{ scale: 0.985 }] } : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      <Text style={look.text({ 'font-size': '14px', 'font-weight': highlighted ? '600' : '450', color: '$ui.ink' })}>{action.label}</Text>
    </FocusPressable>
  );
});
