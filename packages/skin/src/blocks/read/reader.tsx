// The eBook reader (docs/media-kinds.md): the book full screen on paper, light, sepia or dark;
// chrome that steps aside while reading (a tap in the middle of the page, Enter or a remote's
// select brings it back); contents and type settings in side panels; page turns by tap at the
// page's outer quarters, swipe, arrow keys, Page Up/Down, Space and a remote's left and right.
// It opens out of the book's cover (reader-opening.tsx): from the card it was pressed on on the
// web, from the middle of the screen on phones and tablets, where the pages are the same engine in
// a web view (the engine's Surface) and the bars keep clear of the system's. Where the viewer is
// goes to the server as they read.
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, ScrollView, StatusBar, Text, View, type ViewStyle } from 'react-native';
import { msg, percent, type Card } from '@vela/core';
import { FocusPressable as Pressable } from '../../focus';
import { focusElement } from '../../escape';
import { useHost } from '../../host';
import { holdBack } from '../../menu-key';
import { NO_RING, useInteraction } from '../../widgets/common/controls';
import { MediaGlyph } from '../media/icons';
import { useMediaLook } from '../media/parts';
import { READER_THEMES, type ReaderBook, type ReaderEngine, type ReaderLocation, type ReaderSettings, type ReaderTheme } from './reader-engine';
import Animated from 'react-native-reanimated';
import { MOTION, presenceStyle, useLast, usePresence } from '../../presence';
import { type Rect } from './reader-origin';
import { readerLayout, readerPosition, safeFraction } from './reader-layout';
import { BookOpening, CLOSING_TOTAL, readerLayerStyle, useOpening } from './reader-opening';

const web = Platform.OS === 'web';
/** The controls shown as the book opens step aside after this long; shown by the viewer, they stay. */
const HINT_MS = 3500;

export interface ReaderPageProps {
  card: Card;
  /** The document: a short-lived URL from the server, asked for when the page opens. */
  open(): Promise<{ url: string; format: 'epub' | 'pdf' | 'cbz'; mimeType: string; locator?: string; fraction?: number }>;
  engine: ReaderEngine | null;
  settings: ReaderSettings;
  onSettings(settings: ReaderSettings): void;
  onLocation(location: ReaderLocation): void;
  onClose(): void;
  /** The cover it opened from (web): it grows out of it and shrinks back into it. */
  origin?: Rect | null;
}

export function ReaderPage({ card, open, engine, settings, onSettings, onLocation, onClose: leave, origin = null }: ReaderPageProps) {
  const m = useMediaLook();
  const still = m.look.still;
  const animated = !still && !Platform.isTV;
  const insets = useSafeInsets();
  const frame = useRef<ComponentRef<typeof View>>(null);
  const [book, setBook] = useState<ReaderBook | null>(null);
  const [location, setLocation] = useState<ReaderLocation | null>(null);
  const [failed, setFailed] = useState(false);
  const [chrome, setChrome] = useState(false);
  const [panel, setPanel] = useState<'' | 'contents' | 'type'>('');
  const theme = READER_THEMES[settings.theme];
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // The book opens out of its cover once its pages are drawn (or cannot be).
  const opening = useOpening(animated, !!book || failed || !engine);
  // On the web the reader leaves with its motion before the route goes; native routes fade.
  const [closing, setClosing] = useState(false);
  const left = useRef(false);
  const onClose = useCallback(() => {
    if (left.current) return;
    left.current = true;
    if (!animated) { leave(); return; }
    setPanel('');
    setClosing(true);
    setTimeout(leave, CLOSING_TOTAL);
  }, [leave, animated]);

  useEffect(() => {
    if (!engine || !frame.current) return;
    let live = true;
    const offLocation = engine.onLocation(next => { if (live) { setLocation(next); onLocation(next); } });
    void open().then(source => engine.open(source, frame.current, settingsRef.current, source.locator))
      .then(opened => { if (live) setBook(opened); })
      .catch(reason => {
        // The viewer sees plain copy; the cause goes to the console for whoever is debugging.
        console.warn('Vela reader: the book could not be opened', reason);
        if (live) setFailed(true);
      });
    return () => { live = false; offLocation(); engine.destroy(); };
  // The document opens once per page; settings apply separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);
  useEffect(() => { engine?.apply(settings); }, [engine, settings]);

  // The controls: shown briefly as the book opens, then out of the way. A tap in the middle of the
  // page (or Enter) shows them until the next tap or page turn.
  const hideLater = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showChrome = useCallback((show: boolean, briefly = false) => {
    clearTimeout(hideLater.current);
    setChrome(show);
    if (show && briefly) hideLater.current = setTimeout(() => setChrome(false), HINT_MS);
  }, []);
  const opened = !!book && (opening === 'done' || opening === 'fill');
  useEffect(() => { if (opened) showChrome(true, true); return () => clearTimeout(hideLater.current); }, [opened, showChrome]);

  const panelRef = useRef(panel);
  panelRef.current = panel;
  const turn = useCallback((direction: 'next' | 'previous') => {
    if (!engine) return;
    if (direction === 'next') engine.next(); else engine.previous();
    if (!panelRef.current) showChrome(false);
  }, [engine, showChrome]);
  const toggle = useCallback(() => {
    if (panelRef.current) { setPanel(''); return; }
    clearTimeout(hideLater.current);
    setChrome(shown => !shown);
  }, []);

  useEffect(() => engine?.onInput(input => {
    if (input === 'next' || input === 'previous') turn(input);
    else if (input === 'toggle-chrome') toggle();
    else if (input === 'show-chrome') { showChrome(true); requestAnimationFrame(() => focusElement('reader-close')); }
    else if (input === 'escape') { if (panelRef.current) setPanel(''); else onClose(); }
  }), [engine, turn, toggle, showChrome, onClose]);

  useEffect(() => {
    if (!web || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || target?.tagName === 'INPUT' || event.altKey || event.ctrlKey || event.metaKey) return;
      const inPanel = !!target?.closest?.('[data-reader-panel]');
      const onControl = !!target?.closest?.('[role="button"], [role="link"], [role="radio"], [role="adjustable"], a, button');
      if (event.key === 'Escape') { event.preventDefault(); if (panel) setPanel(''); else onClose(); return; }
      if (inPanel) return;
      if (event.key === 'Tab' && !chrome) showChrome(true);
      // Enter on the page (a remote's select) shows or hides the controls; on a control it presses it.
      if (event.key === 'Enter' && !onControl) { event.preventDefault(); toggle(); return; }
      if (['ArrowRight', 'PageDown'].includes(event.key) || (event.key === ' ' && !event.shiftKey && !onControl)) { event.preventDefault(); turn(book?.rtl && event.key === 'ArrowRight' ? 'previous' : 'next'); }
      else if (['ArrowLeft', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey)) { event.preventDefault(); turn(book?.rtl && event.key === 'ArrowLeft' ? 'next' : 'previous'); }
      else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !onControl && settings.flow !== 'scrolled') { event.preventDefault(); showChrome(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn, toggle, panel, onClose, book?.rtl, chrome, showChrome, settings.flow]);

  // With a mouse, the controls come back when the pointer nears the top or bottom edge, where
  // the bars live, and step aside again a moment after it leaves those edges (a tap or key keeps
  // working as before). Touch pointers are ignored: phones use the tap zones.
  const hovered = useRef(false);
  useEffect(() => {
    if (!web || typeof window === 'undefined') return;
    const edge = (y: number) => y <= (m.small ? 52 : 60) + 48 || y >= window.innerHeight - (m.small ? 46 : 52) - 48;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      if (edge(event.clientY)) {
        if (!hovered.current || !chrome) { hovered.current = true; showChrome(true); }
      } else if (hovered.current && !panelRef.current) {
        hovered.current = false;
        clearTimeout(hideLater.current);
        hideLater.current = setTimeout(() => setChrome(false), 1200);
      }
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [chrome, showChrome, m.small]);

  // Back (Android's, or a keyboard's on a tablet) closes a side panel, then the book.
  useEffect(() => holdBack(() => {
    if (panelRef.current) setPanel(''); else onClose();
    return true;
  }), [onClose]);

  const position = readerPosition(location);
  const layout = readerLayout(m.width, m.height, settings.fontSize);
  const topBar = (m.small ? 52 : 60) + insets.top, bottomBar = (m.small ? 46 : 52) + insets.bottom;
  // The bars step aside up and down, and come back the same way (presence.tsx).
  const bars = !!(chrome || panel) && !closing;
  const bar = (style: ViewStyle, edge: 1 | -1) => [{ position: 'absolute', left: 0, right: 0, backgroundColor: theme.page,
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: (m.small ? 10 : 18) + insets.left, paddingRight: (m.small ? 10 : 18) + insets.right, zIndex: 5 } as ViewStyle, style,
    presenceStyle(bars, { y: edge * 14 }, still)];
  const sheet = usePresence(!!panel, MOTION.exit, still);
  const shownPanel = useLast(panel || undefined);
  return (
    // A modal over the page it opened from: assistive technologies stay in the book.
    <View style={{ flex: 1 }} testID="reader" pointerEvents={closing ? 'none' : 'box-none'} accessibilityViewIsModal>
      {!web ? <StatusBar barStyle={settings.theme === 'dark' ? 'light-content' : 'dark-content'} animated /> : null}
      {animated ? <BookOpening cover={card.poster} sharper={book?.cover} title={card.name} byline={card.media?.byline} accent={card.accent} origin={origin}
        paper={theme.page} endpaper={theme.rule} opening={opening} closing={closing} /> : null}
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.page }, animated ? readerLayerStyle(opening, closing) : null]} testID="reader-layer">
        {/* The pages: the text block sits between the bars' places, so the bars never cover a line. */}
        <View ref={frame} style={{ position: 'absolute', top: layout.top + insets.top, bottom: layout.bottom + insets.bottom, left: insets.left, right: insets.right }} testID="reader-frame"
          accessibilityLabel={card.name}>
          {engine?.Surface ? <engine.Surface page={theme.page} /> : null}
        </View>
        {!engine ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', padding: 32 }} accessibilityRole="alert">
          <Text style={m.text({ 'font-size': '16px', color: theme.ink, 'text-align': 'center' })}>{msg('media.reader.unsupported')}</Text>
        </View> : null}
        {engine && !book && !failed ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={m.text({ 'font-family': '"Iowan Old Style", Georgia, serif', 'font-size': '20px', 'font-style': 'italic', color: theme.quiet })}>{card.name}</Text>
        </View> : null}
        {failed ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }} accessibilityRole="alert">
          <Text style={m.text({ 'font-size': '17px', color: theme.ink, 'text-align': 'center' })}>{msg('media.reader.failed')}</Text>
        </View> : null}
        <Animated.View onFocus={() => showChrome(true)} pointerEvents={bars ? 'auto' : 'none'} style={bar({ top: 0, height: topBar, paddingTop: insets.top, borderBottomWidth: 1, borderBottomColor: theme.rule }, -1)} testID="reader-top">
          <ReaderButton icon="back" label={msg('media.ui.back')} onPress={onClose} color={theme.ink} testID="reader-close" nativeID="reader-close" />
          <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
            <Text numberOfLines={1} style={m.text({ 'font-family': '"Iowan Old Style", "Palatino Linotype", Georgia, serif', 'font-size': '15px', 'font-weight': '600', color: theme.ink })}>{book?.title || card.name}</Text>
            {location?.chapter ? <Text numberOfLines={1} style={m.text({ 'font-size': '12px', color: theme.quiet })}>{location.chapter}</Text> : null}
          </View>
          <ReaderButton icon="contents" label={msg('media.reader.contents')} onPress={() => setPanel(panel === 'contents' ? '' : 'contents')} color={theme.ink} active={panel === 'contents'} testID="reader-contents" />
          <ReaderButton icon="text" label={msg('media.reader.type')} onPress={() => setPanel(panel === 'type' ? '' : 'type')} color={theme.ink} active={panel === 'type'} testID="reader-type" />
        </Animated.View>
        <Animated.View onFocus={() => showChrome(true)} pointerEvents={bars ? 'auto' : 'none'} style={bar({ bottom: 0, height: bottomBar, paddingBottom: insets.bottom, borderTopWidth: 1, borderTopColor: theme.rule }, 1)} testID="reader-bottom">
          <ReaderButton icon="back" label={msg('media.reader.previous')} onPress={() => turn('previous')} color={theme.ink} testID="reader-previous" />
          <ProgressTrack fraction={safeFraction(location?.fraction) ?? 0} color={theme.ink} rule={theme.rule} onSeek={fraction => engine?.goToFraction(fraction)} />
          {/* Unknown parts are left out (reader-layout.ts readerPosition), never drawn as NaN. */}
          <Text numberOfLines={1} style={m.text({ 'font-size': '12px', color: theme.quiet, 'font-variant-numeric': 'tabular-nums', 'min-width': '92px', 'text-align': 'right' })} testID="reader-progress">
            {m.small ? position.percent : position.line}
          </Text>
          <View style={{ transform: [{ scaleX: -1 }] }}><ReaderButton icon="back" label={msg('media.reader.next')} onPress={() => turn('next')} color={theme.ink} testID="reader-next" /></View>
        </Animated.View>
        {!bars && position.line ? <Text pointerEvents="none" testID="reader-hint" style={[m.text({ 'font-size': '11px', color: theme.quiet, 'font-variant-numeric': 'tabular-nums' }),
          { position: 'absolute', bottom: insets.bottom + Math.max(10, Math.round((layout.bottom - 14) / 2)), alignSelf: 'center' }]}>{m.small ? position.percent : position.line}</Text> : null}
        {sheet.mounted && shownPanel ? <Panel theme={settings.theme} visible={sheet.visible} still={still} onClose={() => setPanel('')} title={shownPanel === 'contents' ? msg('media.reader.contents') : msg('media.reader.type')}>
          {shownPanel === 'contents'
            ? (book?.toc.length ? book.toc.map((item, i) => <TocRow key={`${item.href}-${i}`} item={item} theme={settings.theme} current={location?.tocHref === item.href}
                onPress={() => { engine?.goTo(item.href); setPanel(''); setChrome(false); }} />)
              : <Text style={m.text({ 'font-size': '14px', color: theme.quiet })}>{msg('media.reader.noContents')}</Text>)
            : <TypeSettings settings={settings} onChange={onSettings} />}
        </Panel> : null}
      </Animated.View>
    </View>
  );
}

/** Where the system's bars, notches and camera cut-outs are. The reader draws beneath them, edge to
 * edge (its route is not padded): the sides an app's screens are otherwise padded by
 * (viewport.sides) count here as insets. */
function useSafeInsets(): { top: number; right: number; bottom: number; left: number } {
  const { insets, sides } = useHost().viewport;
  return { top: insets.top, bottom: insets.bottom, left: insets.left + (sides?.left ?? 0), right: insets.right + (sides?.right ?? 0) };
}

function ReaderButton({ icon, label, onPress, color, active = false, testID, nativeID }: { icon: string; label: string; onPress(): void; color: string; active?: boolean; testID?: string; nativeID?: string }) {
  const { state, handlers } = useInteraction();
  return (
    <Pressable {...handlers} onPress={onPress} testID={testID} nativeID={nativeID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: active }}
      style={[NO_RING, { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
        backgroundColor: active || state.hover || state.focus ? `${color}14` : 'transparent', outlineColor: color, outlineWidth: state.focus ? 2 : 0, outlineStyle: 'solid' } as ViewStyle]}>
      <MediaGlyph name={icon} size={20} color={color} />
    </Pressable>
  );
}

function ProgressTrack({ fraction, color, rule, onSeek }: { fraction: number; color: string; rule: string; onSeek(fraction: number): void }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const seek = (pageX: number) => ref.current?.measureInWindow((x: number, _y: number, width: number) => onSeek(Math.min(1, Math.max(0, (pageX - x) / Math.max(1, width)))));
  return (
    <View ref={ref} style={[{ flex: 1, height: 28, justifyContent: 'center' }, web ? ({ cursor: 'pointer' } as ViewStyle) : {}]}
      onStartShouldSetResponder={() => true} onResponderRelease={event => seek(event.nativeEvent.pageX)}
      accessibilityRole="adjustable" accessibilityLabel={msg('media.reader.position')} accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}>
      <View style={{ height: 3, borderRadius: 2, backgroundColor: rule }}>
        <View style={{ width: `${Math.min(100, fraction * 100)}%`, height: 3, borderRadius: 2, backgroundColor: color, opacity: 0.75 }} />
      </View>
    </View>
  );
}

/** A side panel: it slides in from the edge over a scrim that dissolves in, and back out. */
function Panel({ theme, title, visible, still, onClose, children }: { theme: ReaderTheme; title: string; visible: boolean; still: boolean; onClose(): void; children: React.ReactNode }) {
  const m = useMediaLook();
  const colours = READER_THEMES[theme];
  const insets = useSafeInsets();
  const width = Math.min(380, m.width - 32) + insets.right;
  return (
    <>
      <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 8 }, presenceStyle(visible, { opacity: 0 }, still)]}>
        <Pressable onPress={onClose} accessibilityLabel={msg('media.reader.closePanel')} style={[NO_RING, { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.18)' }]} />
      </Animated.View>
      <Animated.View {...({ dataSet: { readerPanel: '1' } } as object)} pointerEvents={visible ? 'auto' : 'none'} style={[{ position: 'absolute', top: 0, bottom: 0, right: 0, width, backgroundColor: colours.page, zIndex: 9,
        borderLeftWidth: 1, borderLeftColor: colours.rule }, m.box({ 'box-shadow': '-24px 0px 48px -24px rgba(0, 0, 0, 0.35)' }), presenceStyle(visible, { opacity: 1, x: width + 24 }, still)]} accessibilityViewIsModal testID="reader-panel">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 20 + insets.right, paddingTop: insets.top, height: 60 + insets.top, borderBottomWidth: 1, borderBottomColor: colours.rule }}>
          <Text accessibilityRole="header" style={m.text({ 'font-family': '"Iowan Old Style", Georgia, serif', 'font-size': '20px', color: colours.ink })}>{title}</Text>
          <ReaderButton icon="close" label={msg('media.reader.closePanel')} onPress={onClose} color={colours.ink} testID="reader-panel-close" />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingRight: 16 + insets.right, paddingBottom: 16 + insets.bottom, gap: 2 }}>{children}</ScrollView>
      </Animated.View>
    </>
  );
}

function TocRow({ item, theme, current, onPress }: { item: { label: string; depth: number }; theme: ReaderTheme; current: boolean; onPress(): void }) {
  const m = useMediaLook();
  const colours = READER_THEMES[theme];
  const { state, handlers } = useInteraction();
  return (
    <Pressable {...handlers} onPress={onPress} accessibilityRole="link" accessibilityState={{ selected: current }}
      style={[NO_RING, { paddingVertical: 10, paddingLeft: 12 + item.depth * 16, paddingRight: 12, borderRadius: 8,
        backgroundColor: current ? `${colours.link}1f` : state.hover || state.focus ? `${colours.ink}0d` : 'transparent',
        outlineColor: colours.ink, outlineWidth: state.focus ? 2 : 0, outlineStyle: 'solid' } as ViewStyle]}>
      <Text style={m.text({ 'font-family': '"Iowan Old Style", "Palatino Linotype", Georgia, serif', 'font-size': item.depth ? '14px' : '16px', color: current ? colours.link : colours.ink })}>{item.label}</Text>
    </Pressable>
  );
}

function TypeSettings({ settings, onChange }: { settings: ReaderSettings; onChange(settings: ReaderSettings): void }) {
  const m = useMediaLook();
  const colours = READER_THEMES[settings.theme];
  const label = (text: string) => <Text style={[m.text({ 'font-size': '11px', 'font-weight': '700', 'letter-spacing': '0.16em', 'text-transform': 'uppercase', color: colours.quiet }), { marginTop: 20, marginBottom: 10 }]}>{text}</Text>;
  const set = (change: Partial<ReaderSettings>) => onChange({ ...settings, ...change });
  return (
    <View style={{ paddingHorizontal: 4 }}>
      {label(msg('media.reader.theme'))}
      <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup" accessibilityLabel={msg('media.reader.theme')}>
        {(['light', 'sepia', 'dark'] as const).map(theme => (
          <Option key={theme} selected={settings.theme === theme} onPress={() => set({ theme })} colours={colours} testID={`reader-theme-${theme}`}
            swatch={READER_THEMES[theme]} label={msg(`media.reader.theme.${theme}`)} />
        ))}
      </View>
      {label(msg('media.reader.size'))}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Option label="A−" name={msg('media.reader.smaller')} onPress={() => set({ fontSize: Math.max(70, settings.fontSize - 10) })} colours={colours} testID="reader-smaller" small />
        <Text style={m.text({ flex: '1', 'text-align': 'center', 'font-size': '14px', color: colours.ink, 'font-variant-numeric': 'tabular-nums' })} testID="reader-size">{percent(settings.fontSize / 100)}</Text>
        <Option label="A+" name={msg('media.reader.larger')} onPress={() => set({ fontSize: Math.min(220, settings.fontSize + 10) })} colours={colours} testID="reader-larger" />
      </View>
      {label(msg('media.reader.font'))}
      <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup" accessibilityLabel={msg('media.reader.font')}>
        {(['serif', 'sans', 'publisher'] as const).map(font => <Option key={font} label={msg(`media.reader.font.${font}`)} selected={settings.font === font} onPress={() => set({ font })} colours={colours} testID={`reader-font-${font}`} />)}
      </View>
      {label(msg('media.reader.spacing'))}
      <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup" accessibilityLabel={msg('media.reader.spacing')}>
        {[1.3, 1.5, 1.8].map(lineHeight => <Option key={lineHeight} label={msg(`media.reader.spacing.${lineHeight === 1.3 ? 'tight' : lineHeight === 1.5 ? 'normal' : 'loose'}`)} selected={settings.lineHeight === lineHeight} onPress={() => set({ lineHeight })} colours={colours} />)}
      </View>
      {label(msg('media.reader.layout'))}
      <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup" accessibilityLabel={msg('media.reader.layout')}>
        {(['paginated', 'scrolled'] as const).map(flow => <Option key={flow} label={msg(`media.reader.flow.${flow}`)} selected={settings.flow === flow} onPress={() => set({ flow })} colours={colours} testID={`reader-flow-${flow}`} />)}
      </View>
    </View>
  );
}

/** One choice of a setting (a radio), or with no `selected` an action such as a size step (a button named `name`). */
function Option({ label, name, selected, onPress, colours, swatch, testID, small = false }: {
  label: string; name?: string; selected?: boolean; onPress(): void; colours: (typeof READER_THEMES)[ReaderTheme]; swatch?: (typeof READER_THEMES)[ReaderTheme]; testID?: string; small?: boolean;
}) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  return (
    <Pressable {...handlers} onPress={onPress} testID={testID} accessibilityLabel={name ?? label}
      {...(selected === undefined ? { accessibilityRole: 'button' as const } : { accessibilityRole: 'radio' as const, accessibilityState: { checked: selected }, ...(Platform.OS === 'web' ? { 'aria-checked': selected } : {}) })}
      style={[NO_RING, { flex: 1, height: swatch ? 64 : 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 4,
        backgroundColor: swatch ? swatch.page : state.hover || state.focus ? `${colours.ink}12` : `${colours.ink}08`,
        borderWidth: selected ? 2 : 1, borderColor: selected ? colours.link : colours.rule, outlineColor: colours.ink, outlineWidth: state.focus ? 2 : 0, outlineStyle: 'solid', outlineOffset: 2 } as ViewStyle]}>
      {swatch ? <Text style={m.text({ 'font-family': 'Georgia, serif', 'font-size': '20px', color: swatch.ink })}>Aa</Text> : null}
      <Text style={m.text({ 'font-size': small ? '14px' : '13px', 'font-weight': '600', color: swatch ? swatch.ink : colours.ink })}>{label}</Text>
    </Pressable>
  );
}
