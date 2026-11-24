// The music app's pieces in the document's `ui` look: tiles with a play button that rises on
// hover, shelves, the heart, the big play button, a byline whose names open their pages.
import { Image } from 'expo-image';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type ComponentRef } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TVFocusGuideView, View, useTVEventHandler, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import type { CardMenuAnchor, CardMenuOpenMode } from '../card-context-menu';
import type { Focusable } from '../../escape';
import { placeParam } from './place';
import { musicTV } from './layout';
import { msg, type Card } from '@vela/core';
import { FocusPressable as Pressable } from '../../focus';
import { useHost } from '../../host';
import { NO_RING, Glyph, useInteraction } from '../common/controls';
import { alpha, Cover, useMediaLook } from '../media/parts';
import { MediaGlyph } from '../media/icons';
import { placeOf, useMusic } from './context';
import { listenedFraction } from './listening';
import { SYMBOLS } from '../../icons';

/** A Vela symbol, or the media player's glyph of that name (shuffle, repeat, repeatOne). */
export function Icon({ name, size, color }: { name: string; size: number; color: string }) {
  return SYMBOLS[name] ? <Glyph symbol={name} size={size} color={color} /> : <MediaGlyph name={name === 'repeat-one' ? 'repeatOne' : name} size={size} color={color} />;
}

const web = Platform.OS === 'web';
export const transition = (properties: string, ms = 200): ViewStyle => (web ? ({ transitionProperty: properties, transitionDuration: `${ms}ms`, transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' } as ViewStyle) : {});

/** How a card's menu was asked for and where it opens: at the pointer, under a finger, or beside
 * the focused card on a TV (long select or the remote's menu event, as Vela's cards do). */
export type MenuOpen = (anchor: CardMenuAnchor, mode: CardMenuOpenMode, opener: Focusable | null) => void;

const useTVMenuEvent: (handler: (event: { eventType: string }) => void) => void = typeof useTVEventHandler === 'function'
  ? useTVEventHandler as never
  : () => undefined;

/** Right-click (web) or long-press opens a menu at the pointer (kept for plain pressables). */
export function menuHandlers(open: (point: { x: number; y: number }) => void) {
  return {
    onLongPress: (event: GestureResponderEvent) => open({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }),
    ...(web ? { onContextMenu: (event: { preventDefault(): void; nativeEvent: { pageX: number; pageY: number } }) => { event.preventDefault(); open({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }); } } : {}),
  };
}

/** Where focus was last on each music page, so coming back to a page lands where you left it. */
const remembered = new Map<string, string>();

/** The group a card sits in (a shelf, the quick tiles, a tracklist): the same album can sit in
 * several on one page, and focus must come back to the one you left. */
export const FocusScope = createContext('');

export function useHover(): [boolean, object] {
  const [hover, setHover] = useState(false);
  return [hover, web ? { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) } : {}];
}

/**
 * A pressable surface that holds its own buttons (a tile's play button, a row's heart and ⋯):
 * the press target lies under the content, so no button sits inside another. Text in `children`
 * passes presses through to it; buttons on top take their own.
 */
export function Surface({ onPress, onMenu, onDoubleClick, label, testID, style, contentStyle, children, selected, focusId }: {
  onPress?(): void; onMenu?: MenuOpen; onDoubleClick?(): void; label: string; testID?: string; selected?: boolean;
  /** Stable id for focus memory on a TV (a card or track id). */
  focusId?: string;
  style(lit: boolean, focus: boolean): StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle>; children(lit: boolean): ReactNode;
}) {
  const app = useMusic();
  const scope = useContext(FocusScope);
  const memoryId = focusId ? `${scope}/${focusId}` : '';
  const [hover, hoverProps] = useHover();
  const { state, handlers } = useInteraction();
  const lit = hover || state.focus;
  const ref = useRef<ComponentRef<typeof Pressable>>(null);
  const focused = useRef(false);
  const page = placeParam(app.place);
  const opener = () => ref.current as unknown as Focusable | null;
  const atCard = (mode: CardMenuOpenMode) => (ref.current as unknown as { measureInWindow?(cb: (x: number, y: number, w: number, h: number) => void): void } | null)
    ?.measureInWindow?.((x, y, w, h) => onMenu?.({ kind: 'card', rect: { left: x, top: y, right: x + w, bottom: y + h } }, mode, opener()));
  useTVMenuEvent(event => {
    if (!Platform.isTV || !focused.current || !onMenu) return;
    // Android TV's Menu key opens the card's menu; tvOS's Menu is Back (it reaches here while a page
    // holds Back), so there only a long select does.
    if (event.eventType === 'longSelect' || (event.eventType === 'menu' && Platform.OS !== 'ios')) atCard('tv');
  });
  const menu = onMenu ? {
    onLongPress: (event: GestureResponderEvent) => (Platform.isTV ? atCard('tv') : onMenu({ kind: 'point', point: { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY } }, 'touch', opener())),
    ...(web ? { onContextMenu: (event: { preventDefault(): void; nativeEvent: { pageX: number; pageY: number } }) => { event.preventDefault(); onMenu({ kind: 'point', point: { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY } }, 'pointer', opener()); } } : {}),
  } : {};
  const h = handlers as { onFocus?(e: unknown): void; onBlur?(e: unknown): void };
  // React Native Web drops onDoubleClick: listen on the element itself.
  const double = useRef(onDoubleClick);
  double.current = onDoubleClick;
  const wantsDouble = web && !!onDoubleClick;
  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null;
    if (!wantsDouble || !node?.addEventListener) return;
    const handle = () => double.current?.();
    node.addEventListener('dblclick', handle);
    return () => node.removeEventListener('dblclick', handle);
  }, [wantsDouble]);
  return (
    <View {...hoverProps} style={style(lit, state.focus)}>
      <Pressable ref={ref} {...handlers} {...menu} onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }}
        onFocus={(e: unknown) => { focused.current = true; if (memoryId) remembered.set(page, memoryId); h.onFocus?.(e); }}
        onBlur={(e: unknown) => { focused.current = false; h.onBlur?.(e); }}
        {...(Platform.isTV && memoryId && remembered.get(page) === memoryId ? { hasTVPreferredFocus: true } : {})}
        {...(web && onDoubleClick ? { onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') onDoubleClick(); } } as object : {})}
        style={[NO_RING, StyleSheet.absoluteFill]} />
      <View pointerEvents="box-none" style={contentStyle}>{children(lit)}</View>
    </View>
  );
}

/** A TV focus guide that remembers its last focused child (a shelf, a tracklist, the rail);
 * a plain view elsewhere. */
export function FocusGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  if (!Platform.isTV) return <View style={style}>{children}</View>;
  return <TVFocusGuideView autoFocus style={style}>{children}</TVFocusGuideView>;
}

/** On a TV a page opens with focus on its Play button, unless you are coming back to a spot. */
function useOpensHere(wanted: boolean): boolean {
  const app = useMusic();
  return wanted && Platform.isTV && !remembered.has(placeParam(app.place));
}

export function PlayFab({ playing, onPress, size = 56, label, testID, opensPage = false }: { playing: boolean; onPress(): void; size?: number; label?: string; testID?: string; opensPage?: boolean }) {
  const m = useMediaLook();
  const preferred = useOpensHere(opensPage);
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={label ?? (playing ? msg('media.player.pause') : msg('media.player.play'))}
      {...(preferred ? { hasTVPreferredFocus: true } : {})}
      style={[NO_RING, { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: m.ui.accent,
        transform: [{ scale: state.pressed ? 0.95 : lit ? 1.08 : 1 }] }, state.focus && musicTV() ? { borderWidth: 3, borderColor: m.ui.ink } : {}, m.box({ 'box-shadow': `0px 10px 28px -8px ${alpha(m.ui.accent, 0.7)}` }), transition('transform')]}>
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
        transform: [{ scale: state.pressed ? 0.92 : state.focus && musicTV() ? 1.1 : 1 }] }, state.focus && musicTV() ? { borderWidth: 2, borderColor: m.ui.ink } : {}, transition('transform, background-color', 140)]}>
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
  const label = role === 'artist' || role === 'show' ? msg(on ? 'cardMenu.unfollow' : 'cardMenu.follow') : role === 'track' ? msg(on ? 'cardMenu.unlikeSong' : 'cardMenu.likeSong') : msg(on ? 'cardMenu.removeFromLibrary' : 'cardMenu.saveToLibrary');
  if (quiet && !on) return <View style={{ width: size, height: size }} />;
  return <IconButton symbol={on ? 'heart-fill' : 'heart'} label={label} onPress={() => app.like(card, !on)} size={size} iconSize={iconSize} color={on ? m.ui.accent : undefined} testID={`like-${card.id}`} />;
}

/** A square (or round, for an artist) tile with its name; a play button rises on hover. */
export function MusicTile({ card, size: wanted, subtitle, testID }: { card: Card; size: number; subtitle?: string; testID?: string }) {
  const app = useMusic();
  const m = useMediaLook();
  const size = m.small ? Math.min(wanted, 132) : wanted;
  const round = card.media?.role === 'artist';
  const role = card.media?.role;
  const playable = role === 'album' || role === 'track' || card.kind === 'playlist' || role === 'audiobook' || role === 'part' || role === 'show' || role === 'episode';
  // An episode names its show, a part its book; spoken word shows where the viewer is.
  const line = subtitle ?? (round ? msg('media.ui.artist') : role === 'episode' || role === 'part' ? [card.media?.parent?.name, card.media?.byline].filter(Boolean)[0] ?? ''
    : role === 'show' ? card.media?.byline ?? '' : [card.yearLabel, card.media?.byline].filter(Boolean).join(' · '));
  const listened = listenedFraction(card);
  return (
    <Surface onPress={() => app.go(placeOf(card))} onMenu={(anchor, mode, opener) => app.menu({ card, anchor, mode, opener })} focusId={card.id} testID={testID} label={[card.name, line].filter(Boolean).join(', ')}
      style={(lit, focus) => [{ width: size + (m.small ? 16 : 24), borderRadius: Number(m.ui.radiusCard) || 12, backgroundColor: lit ? m.ui.control : 'transparent' },
        musicTV() ? { borderWidth: 2, borderColor: focus ? m.ui.ink : 'transparent', transform: [{ scale: focus ? 1.04 : 1 }] } : {}, transition('background-color, transform', 160)]}
      contentStyle={{ padding: m.small ? 8 : 12, gap: 10 }}>
      {lit => (
        <>
          <View pointerEvents="box-none" style={{ width: size, height: size }}>
            <View pointerEvents="none"><Cover uri={card.poster} shape={round ? 'round' : 'square'} size={size} title={card.name} byline={card.media?.byline} accent={card.accent} lift={lit ? 1.5 : 1} /></View>
            {listened > 0 ? (
              <View pointerEvents="none" style={{ position: 'absolute', left: 8, right: 8, bottom: 8, height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: alpha('#000000', 0.5) }} testID={`music-tile-progress-${card.id}`}>
                <View style={{ width: `${Math.round(listened * 100)}%`, height: 4, backgroundColor: m.ui.accent }} />
              </View>
            ) : null}
            {playable && !musicTV() ? (
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

/** A TV's focused tile grows and wears a ring; a shelf scrolls and clips to its bounds, so on a TV
 * it has room around its tiles, laid out where it would be without it. */
const SHELF_TV_ROOM: ViewStyle = { padding: 12 };
const SHELF_TV_BLEED: ViewStyle = { margin: -12 };

export function Shelf({ title, detail, children, onMore }: { title: string; detail?: string; children: ReactNode; onMore?(): void }) {
  const m = useMediaLook();
  return (
    <View style={{ marginBottom: 28 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: 4 }}>
        <Text accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': m.small ? '22px' : '26px', color: '$ui.ink', 'letter-spacing': '-0.01em' })}>{title}</Text>
        {onMore ? <Pressable onPress={onMore} accessibilityRole="link" style={NO_RING}><Text style={m.text({ 'font-size': '13px', 'font-weight': '650', color: '$ui.inkQuiet' })}>{msg('music.showAll')}</Text></Pressable> : null}
      </View>
      {detail ? <Text style={[m.text({ 'font-size': '13px', color: '$ui.inkQuiet' }), { paddingHorizontal: 12, marginBottom: 4 }]}>{detail}</Text> : null}
      <FocusScope.Provider value={`shelf:${title}`}><FocusGroup><ScrollView horizontal showsHorizontalScrollIndicator={false} style={musicTV() ? SHELF_TV_BLEED : undefined} contentContainerStyle={musicTV() ? SHELF_TV_ROOM : { gap: 0 }}>{children}</ScrollView></FocusGroup></FocusScope.Provider>
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
