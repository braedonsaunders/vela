// The music app's pieces in the document's `ui` look: tiles with a play button that rises on
// hover, shelves, the heart, the big play button, a byline whose names open their pages.
import { Image } from 'expo-image';
import { useRef, useState, type ReactNode, type ComponentRef } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { msg, type Card } from '@vela/core';
import { FocusPressable as Pressable } from '../../focus';
import { useHost } from '../../host';
import { NO_RING, Glyph, useInteraction } from '../common/controls';
import { alpha, Cover, useMediaLook } from '../media/parts';
import { MediaGlyph } from '../media/icons';
import { placeOf, useMusic } from './context';
import { SYMBOLS } from '../../icons';

/** A Vela symbol, or the media player's glyph of that name (shuffle, repeat, repeatOne). */
export function Icon({ name, size, color }: { name: string; size: number; color: string }) {
  return SYMBOLS[name] ? <Glyph symbol={name} size={size} color={color} /> : <MediaGlyph name={name === 'repeat-one' ? 'repeatOne' : name} size={size} color={color} />;
}

const web = Platform.OS === 'web';
export const transition = (properties: string, ms = 200): ViewStyle => (web ? ({ transitionProperty: properties, transitionDuration: `${ms}ms`, transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' } as ViewStyle) : {});

/** Right-click (web) or long-press opens the card's menu at the pointer. */
export function menuHandlers(open: (point: { x: number; y: number }) => void) {
  return {
    onLongPress: (event: GestureResponderEvent) => open({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }),
    ...(web ? { onContextMenu: (event: { preventDefault(): void; nativeEvent: { pageX: number; pageY: number } }) => { event.preventDefault(); open({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }); } } : {}),
  };
}

export function useHover(): [boolean, object] {
  const [hover, setHover] = useState(false);
  return [hover, web ? { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) } : {}];
}

/**
 * A pressable surface that holds its own buttons (a tile's play button, a row's heart and ⋯):
 * the press target lies under the content, so no button sits inside another. Text in `children`
 * passes presses through to it; buttons on top take their own.
 */
export function Surface({ onPress, onMenu, onDoubleClick, label, testID, style, contentStyle, children, selected }: {
  onPress?(): void; onMenu?(point: { x: number; y: number }): void; onDoubleClick?(): void; label: string; testID?: string; selected?: boolean;
  style(lit: boolean, focus: boolean): StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle>; children(lit: boolean): ReactNode;
}) {
  const [hover, hoverProps] = useHover();
  const { state, handlers } = useInteraction();
  const lit = hover || state.focus;
  return (
    <View {...hoverProps} style={style(lit, state.focus)}>
      <Pressable {...handlers} {...(onMenu ? menuHandlers(onMenu) : {})} onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }}
        {...(web && onDoubleClick ? { onDoubleClick, onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') onDoubleClick(); } } as object : {})}
        style={[NO_RING, StyleSheet.absoluteFill]} />
      <View pointerEvents="box-none" style={contentStyle}>{children(lit)}</View>
    </View>
  );
}

export function PlayFab({ playing, onPress, size = 56, label, testID }: { playing: boolean; onPress(): void; size?: number; label?: string; testID?: string }) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={label ?? (playing ? msg('media.player.pause') : msg('media.player.play'))}
      style={[NO_RING, { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: m.ui.accent,
        transform: [{ scale: state.pressed ? 0.95 : lit ? 1.05 : 1 }] }, m.box({ 'box-shadow': `0px 10px 28px -8px ${alpha(m.ui.accent, 0.7)}` }), transition('transform')]}>
      <MediaGlyph name={playing ? 'pause' : 'play'} size={Math.round(size * 0.42)} color={m.ui.onAccent} />
    </Pressable>
  );
}

export function IconButton({ symbol, label, onPress, size = 40, iconSize = 20, active = false, color, testID }: {
  symbol: string; label: string; onPress(): void; size?: number; iconSize?: number; active?: boolean; color?: string; testID?: string;
}) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  const ink = color ?? (active ? m.ui.accent : lit ? m.ui.ink : m.ui.inkSecondary);
  return (
    <Pressable {...handlers} onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }}
      style={[NO_RING, { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: lit ? m.ui.control : 'transparent',
        transform: [{ scale: state.pressed ? 0.92 : 1 }] }, transition('transform, background-color', 140)]}>
      <Icon name={symbol} size={iconSize} color={ink} />
      {active ? <View style={{ position: 'absolute', bottom: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: m.ui.accent }} /> : null}
    </Pressable>
  );
}

/** The heart: like a song, save an album, follow an artist. */
export function Heart({ card, size = 32, iconSize = 18, quiet = false }: { card: Card; size?: number; iconSize?: number; quiet?: boolean }) {
  const app = useMusic();
  const m = useMediaLook();
  const on = app.liked(card.id);
  const role = card.media?.role;
  const label = role === 'artist' ? msg(on ? 'cardMenu.unfollow' : 'cardMenu.follow') : role === 'track' ? msg(on ? 'cardMenu.unlikeSong' : 'cardMenu.likeSong') : msg(on ? 'cardMenu.removeFromLibrary' : 'cardMenu.saveToLibrary');
  if (quiet && !on) return <View style={{ width: size, height: size }} />;
  return <IconButton symbol={on ? 'heart-fill' : 'heart'} label={label} onPress={() => app.like(card, !on)} size={size} iconSize={iconSize} color={on ? m.ui.accent : undefined} testID={`like-${card.id}`} />;
}

/** A square (or round, for an artist) tile with its name; a play button rises on hover. */
export function MusicTile({ card, size, subtitle, testID }: { card: Card; size: number; subtitle?: string; testID?: string }) {
  const app = useMusic();
  const m = useMediaLook();
  const round = card.media?.role === 'artist';
  const playable = card.media?.role === 'album' || card.media?.role === 'track' || card.kind === 'playlist';
  const line = subtitle ?? (round ? msg('media.ui.artist') : [card.yearLabel, card.media?.byline].filter(Boolean).join(' · '));
  return (
    <Surface onPress={() => app.go(placeOf(card))} onMenu={point => app.menu({ card, anchor: { kind: 'point', point } })} testID={testID} label={[card.name, line].filter(Boolean).join(', ')}
      style={lit => [{ width: size + 24, borderRadius: Number(m.ui.radiusCard) || 12, backgroundColor: lit ? m.ui.control : 'transparent' }, transition('background-color', 160)]}
      contentStyle={{ padding: 12, gap: 10 }}>
      {lit => (
        <>
          <View pointerEvents="box-none" style={{ width: size, height: size }}>
            <View pointerEvents="none"><Cover uri={card.poster} shape={round ? 'round' : 'square'} size={size} title={card.name} byline={card.media?.byline} accent={card.accent} lift={lit ? 1.5 : 1} /></View>
            {playable && !Platform.isTV ? (
              <View pointerEvents={lit ? 'auto' : 'none'} style={[{ position: 'absolute', right: 8, bottom: 8, opacity: lit ? 1 : 0, transform: [{ translateY: lit ? 0 : 10 }] }, transition('opacity, transform', 240)]}>
                <PlayFab playing={false} size={46} onPress={() => app.playCard(card)} label={`${msg('media.ui.play')} ${card.name}`} />
              </View>
            ) : null}
          </View>
          <View pointerEvents="none" style={{ gap: 3, alignItems: round ? 'center' : 'flex-start' }}>
            <Text numberOfLines={1} style={m.text({ 'font-size': '15px', 'font-weight': '650', color: '$ui.ink' })}>{card.name}</Text>
            {line ? <Text numberOfLines={2} style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet', 'text-align': round ? 'center' : 'left' })}>{line}</Text> : null}
          </View>
        </>
      )}
    </Surface>
  );
}

export function Shelf({ title, detail, children, onMore }: { title: string; detail?: string; children: ReactNode; onMore?(): void }) {
  const m = useMediaLook();
  return (
    <View style={{ marginBottom: 28 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: 4 }}>
        <Text accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '26px', color: '$ui.ink', 'letter-spacing': '-0.01em' })}>{title}</Text>
        {onMore ? <Pressable onPress={onMore} accessibilityRole="link" style={NO_RING}><Text style={m.text({ 'font-size': '13px', 'font-weight': '650', color: '$ui.inkQuiet' })}>{msg('music.showAll')}</Text></Pressable> : null}
      </View>
      {detail ? <Text style={[m.text({ 'font-size': '13px', color: '$ui.inkQuiet' }), { paddingHorizontal: 12, marginBottom: 4 }]}>{detail}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 0 }}>{children}</ScrollView>
    </View>
  );
}

/** A wash of the artwork's colour behind a page's header: the Vela touch. */
export function Wash({ accent, height = 420, image }: { accent: string; height?: number; image?: string }) {
  const m = useMediaLook();
  const host = useHost();
  const tint = accent || m.ui.accent;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height, overflow: 'hidden' }}>
      {image ? <Image source={host.image(image)} contentFit="cover" blurRadius={80} style={{ position: 'absolute', top: -80, left: -80, right: -80, bottom: -80, opacity: 0.38 } as never} /> : null}
      <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, m.box({ 'background-image': `linear-gradient(180deg, ${alpha(tint, 0.55)} 0%, ${alpha(tint, 0.18)} 55%, ${alpha(m.ui.page, 0)} 100%)` })]} />
    </View>
  );
}

/** "Daft Punk · 2001 · 14 songs, 1 h 1 min" with the artist as a link. */
export function Byline({ card, facts }: { card: Card; facts: string[] }) {
  const app = useMusic();
  const m = useMediaLook();
  const artist = card.media?.parents.find(p => p.role === 'artist') ?? (card.media?.bylineTarget.startsWith('title:') ? { id: card.media.bylineTarget.slice(6), name: card.media.byline } : undefined);
  const [hover, setHover] = useState(false);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
      {artist ? (
        <Pressable onPress={() => app.go({ kind: 'title', id: artist.id })} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} accessibilityRole="link" style={NO_RING} testID="music-byline-artist">
          <Text style={m.text({ 'font-size': '15px', 'font-weight': '700', color: '$ui.ink', 'text-decoration-line': hover ? 'underline' : 'none' })}>{artist.name}</Text>
        </Pressable>
      ) : null}
      {facts.filter(Boolean).map(fact => <Text key={fact} style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary' })}>· {fact}</Text>)}
    </View>
  );
}
