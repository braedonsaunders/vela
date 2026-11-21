// The pieces media pages are built from (docs/media-kinds.md): covers in their shapes (a square
// sleeve, a round portrait, a bound book with its spine and page edges), pill buttons, tracklist
// rows, cover tiles and section headings. Everything takes the active document's `ui` look, so
// each skin keeps its colours, faces and corners and a third-party skin inherits a good page.
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Platform, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import type { Card, CardShape } from '@vela/core';
import { FocusPressable as Pressable } from '../../focus';
import { useHost } from '../../host';
import { useLook, type Look } from '../common/look';
import { NO_RING, useInteraction } from '../common/controls';
import { MediaGlyph } from './icons';

const web = Platform.OS === 'web';

export interface MediaLook {
  look: Look;
  ui: Look['ui'];
  width: number;
  height: number;
  small: boolean;
  wide: boolean;
  tv: boolean;
  /** The page's side gutter, px. */
  gutter: number;
  text(rows: Record<string, string>): TextStyle;
  box(rows: Record<string, string>): ViewStyle;
}

export function useMediaLook(): MediaLook {
  const host = useHost();
  const look = useLook();
  const width = host.viewport.width;
  const small = width < 640;
  return {
    look, ui: look.ui, width, height: host.viewport.height, small, wide: width >= 980, tv: host.env.tv,
    gutter: small ? 20 : width >= 1600 ? 72 : 48,
    text: rows => look.text(rows),
    box: rows => look.box(rows),
  };
}

/** A colour with alpha, for hex colours; anything else is returned as it is. */
export function alpha(color: string, value: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color.trim());
  if (!hex) return color;
  const full = hex[1]!.length === 3 ? hex[1]!.split('').map(c => c + c).join('') : hex[1]!;
  return `#${full}${Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')}`;
}

/** A cover in its media shape. `size` is the cover's width; a book is half again as tall. */
export function Cover({ uri, shape, size, title, byline, accent, lift = 1 }: {
  uri: string; shape: CardShape; size: number; title: string; byline?: string; accent?: string; lift?: number;
}) {
  const host = useHost();
  const { ui, text, box } = useMediaLook();
  const [failed, setFailed] = useState(false);
  const book = shape === 'book';
  const round = shape === 'round';
  const height = book || shape === '' ? Math.round(size * 1.5) : size;
  const radius = round ? size / 2 : book ? Math.max(2, Math.round(size / 90)) : Math.min(Number(ui.radiusCard) || 8, Math.max(4, Math.round(size / 28)));
  const shadow = box({ 'box-shadow': `0px ${Math.round(14 * lift)}px ${Math.round(34 * lift)}px -${Math.round(10 * lift)}px rgba(0, 0, 0, 0.55), 0px 2px 6px rgba(0, 0, 0, 0.25)` });
  const fill = accent || '#2b2f36';
  const art = uri && !failed
    ? <Image source={host.image(uri)} contentFit="cover" transition={160} onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} accessibilityIgnoresInvertColors />
    // A cover the server has none of: the title set as type on the cover's colour.
    : <View style={{ flex: 1, padding: Math.max(8, size / 12), justifyContent: book ? 'space-between' : 'flex-end', backgroundColor: fill }}>
        <Text numberOfLines={4} style={text({ 'font-family': '$ui.fontDisplay', 'font-size': `${Math.max(12, Math.round(size / 9))}px`, color: '#f7f2e8', 'line-height': '1.1' })}>{title}</Text>
        {byline ? <Text numberOfLines={1} style={text({ 'font-size': `${Math.max(9, Math.round(size / 18))}px`, color: '#f7f2e8cc', 'letter-spacing': '0.08em', 'text-transform': 'uppercase' })}>{byline}</Text> : null}
      </View>;
  return (
    <View style={{ width: size, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {book ? (
        // The text block's page edges, peeking out under the cover at the fore-edge and foot.
        <View style={[{ position: 'absolute', top: 3, left: 4, right: -3, bottom: -3, borderRadius: radius, backgroundColor: '#efe8da' },
          box({ 'background-image': 'repeating-linear-gradient(90deg, #f4efe4 0px, #f4efe4 1px, #ddd4c3 2px)' }), shadow]} />
      ) : null}
      <View style={[{ width: size, height, borderRadius: radius, overflow: 'hidden', backgroundColor: ui.raised }, book ? {} : shadow]}>
        {art}
        {book ? <>
          <View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: Math.max(6, size * 0.07) },
            box({ 'background-image': 'linear-gradient(90deg, rgba(0, 0, 0, 0.38) 0%, rgba(255, 255, 255, 0.24) 26%, rgba(0, 0, 0, 0.2) 56%, rgba(0, 0, 0, 0) 100%)' })]} />
          <View pointerEvents="none" style={[{ position: 'absolute', inset: 0 } as ViewStyle,
            box({ 'background-image': 'linear-gradient(100deg, rgba(255, 255, 255, 0) 55%, rgba(255, 255, 255, 0.08) 72%, rgba(255, 255, 255, 0) 90%)' })]} />
        </> : null}
        {!round ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.08)' }} /> : null}
      </View>
    </View>
  );
}

/** A pill: primary in the document's accent, secondary as a glass control. */
export function PillButton({ label, icon, primary = false, onPress, testID, nativeID, disabled = false, compact = false }: {
  label: string; icon?: string; primary?: boolean; onPress(): void; testID?: string; nativeID?: string; disabled?: boolean; compact?: boolean;
}) {
  const { ui, text, box } = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  const ink = primary ? ui.onAccent : ui.ink;
  const height = compact ? 38 : Math.max(44, Number(ui.controlHeight) || 44);
  return (
    <Pressable {...handlers} onPress={disabled ? undefined : onPress} disabled={disabled} testID={testID} nativeID={nativeID}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
      style={[NO_RING, {
        height, paddingHorizontal: compact ? 16 : 24, borderRadius: Math.min(Number(ui.radiusControl) || 999, height / 2), flexDirection: 'row', alignItems: 'center', gap: 9,
        backgroundColor: primary ? (lit ? ui.inkHover : ui.accent) : lit ? ui.controlHover : ui.control,
        opacity: disabled ? 0.45 : 1, transform: [{ scale: state.pressed ? 0.97 : 1 }],
      }, state.focus ? box({ 'box-shadow': `0px 0px 0px 3px ${ui.focusHalo}, 0px 0px 0px 1.5px ${primary ? ui.accent : ui.ink}` }) : {},
      web ? ({ transitionProperty: 'background-color, transform', transitionDuration: '160ms' } as ViewStyle) : {}]}>
      {icon ? <MediaGlyph name={icon} size={compact ? 16 : 18} color={primary && lit ? ui.inkInverse : ink} /> : null}
      <Text numberOfLines={1} style={text({ 'font-size': compact ? '13px' : '15px', 'font-weight': '650', color: primary && lit ? ui.inkInverse : ink })}>{label}</Text>
    </Pressable>
  );
}

/** A round icon control (shuffle, repeat, back). */
export function RoundButton({ icon, label, onPress, size = 44, active = false, testID, nativeID, iconSize }: {
  icon: string; label: string; onPress(): void; size?: number; active?: boolean; testID?: string; nativeID?: string; iconSize?: number;
}) {
  const { ui, box } = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} testID={testID} nativeID={nativeID} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[NO_RING, { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: lit ? ui.controlHover : ui.control, transform: [{ scale: state.pressed ? 0.94 : 1 }] },
        state.focus ? box({ 'box-shadow': `0px 0px 0px 3px ${ui.focusHalo}, 0px 0px 0px 1.5px ${ui.ink}` }) : {}]}>
      <MediaGlyph name={icon} size={iconSize ?? Math.round(size * 0.45)} color={active ? ui.accent : ui.ink} />
    </Pressable>
  );
}

/** A plain text link: an artist under an album title, an author under a book's. */
export function TextLink({ label, onPress, style, testID }: { label: string; onPress?: () => void; style: TextStyle; testID?: string }) {
  const { ui } = useMediaLook();
  const { state, handlers } = useInteraction();
  if (!onPress) return <Text style={style}>{label}</Text>;
  return (
    <Pressable {...handlers} onPress={onPress} accessibilityRole="link" testID={testID} style={[NO_RING, { alignSelf: 'flex-start', borderRadius: 4 }]}>
      <Text style={[style, (state.hover || state.focus) ? { color: ui.accent, textDecorationLine: 'underline' } : null]}>{label}</Text>
    </Pressable>
  );
}

export function SectionHeading({ title, detail }: { title: string; detail?: string }) {
  const { text, small } = useMediaLook();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: small ? 12 : 16, gap: 12 }} accessibilityRole="header">
      <Text style={text({ 'font-family': '$ui.fontDisplay', 'font-size': small ? '24px' : '30px', color: '$ui.ink', 'letter-spacing': '-0.01em' })}>{title}</Text>
      {detail ? <Text style={text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{detail}</Text> : null}
    </View>
  );
}

/** One row of a tracklist or chapter list. */
export function ListRow({ number, title, subtitle, trailing, current = false, playing = false, onPress, testID, dim = false }: {
  number: string; title: string; subtitle?: string; trailing?: string; current?: boolean; playing?: boolean; onPress(): void; testID?: string; dim?: boolean;
}) {
  const { ui, text, box, small } = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} testID={testID} accessibilityRole="button"
      accessibilityLabel={[title, subtitle, trailing].filter(Boolean).join(', ')} accessibilityState={{ selected: current }}
      style={[NO_RING, { flexDirection: 'row', alignItems: 'center', gap: small ? 12 : 18, paddingVertical: small ? 10 : 11, paddingHorizontal: small ? 10 : 14,
        borderRadius: Math.min(12, Number(ui.radiusCard) || 10), backgroundColor: lit ? ui.control : current ? alpha(ui.accent, 0.12) : 'transparent' },
        state.focus ? box({ 'box-shadow': `inset 0px 0px 0px 1.5px ${ui.ink}` }) : {}]}>
      <View style={{ width: 28, alignItems: 'center' }}>
        {current || lit
          ? <MediaGlyph name={current && playing && !lit ? 'volume' : current && playing ? 'pause' : 'play'} size={16} color={current ? ui.accent : ui.ink} />
          : <Text style={text({ 'font-size': '14px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>{number}</Text>}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={text({ 'font-size': '15px', 'font-weight': '550', color: current ? ui.accent : dim ? ui.inkSecondary : ui.ink })}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={text({ 'font-size': '13px', color: '$ui.inkQuiet', 'margin-top': '2px' })}>{subtitle}</Text> : null}
      </View>
      {trailing ? <Text style={text({ 'font-size': '13px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>{trailing}</Text> : null}
    </Pressable>
  );
}

/** A cover with its name under it: an album on an artist's page, a book in a series. */
export function CoverTile({ card, size, subtitle, onPress, testID, progress }: {
  card: Card; size: number; subtitle?: string; onPress(): void; testID?: string; progress?: number;
}) {
  const { ui, text } = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  const shape = card.shape ?? 'square';
  return (
    <Pressable {...handlers} onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={[card.name, subtitle].filter(Boolean).join(', ')}
      style={[NO_RING, { width: size, gap: 10, transform: [{ translateY: lit ? -4 : 0 }] },
        web ? ({ transitionProperty: 'transform', transitionDuration: '220ms' } as ViewStyle) : {}]}>
      <View style={[{ borderRadius: shape === 'round' ? size / 2 : 6 }, state.focus ? { outlineColor: ui.ink, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 3 } as ViewStyle : {}]}>
        <Cover uri={card.poster} shape={shape || 'square'} size={size} title={card.name} byline={card.media?.byline} accent={card.accent} lift={lit ? 1.4 : 1} />
      </View>
      {progress !== undefined && progress > 0 ? <Progress fraction={progress} /> : null}
      <View style={{ gap: 2, alignItems: shape === 'round' ? 'center' : 'flex-start' }}>
        <Text numberOfLines={2} style={text({ 'font-size': '14px', 'font-weight': '600', color: '$ui.ink', 'text-align': shape === 'round' ? 'center' : 'left' })}>{card.name}</Text>
        {subtitle ? <Text numberOfLines={1} style={text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

export function Progress({ fraction, height = 4 }: { fraction: number; height?: number }) {
  const { ui } = useMediaLook();
  return (
    <View style={{ height, borderRadius: height, backgroundColor: ui.track, overflow: 'hidden' }} accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}>
      <View style={{ width: `${Math.round(Math.min(1, Math.max(0, fraction)) * 1000) / 10}%`, height, backgroundColor: ui.accent, borderRadius: height }} />
    </View>
  );
}

/** A responsive wrap of tiles with even gaps. */
export function TileGrid({ children, gap }: { children: ReactNode; gap: number }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>{children}</View>;
}
