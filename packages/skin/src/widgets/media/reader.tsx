// The eBook reader (docs/media-kinds.md): the book full screen on paper, light, sepia or dark;
// chrome that steps aside while reading (a tap in the middle brings it back); contents and
// type settings in side panels; page turns by tap, swipe, arrow keys, Page Up/Down, Space and a
// remote's left and right. Where the viewer is goes to the server as they read.
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { msg, number, percent, type Card } from '@vela/core';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING, useInteraction } from '../common/controls';
import { MediaGlyph } from './icons';
import { useMediaLook } from './parts';
import { READER_THEMES, type ReaderBook, type ReaderEngine, type ReaderLocation, type ReaderSettings, type ReaderTheme } from './reader-engine';

const web = Platform.OS === 'web';

export interface ReaderPageProps {
  card: Card;
  /** The document: a short-lived URL from the server, asked for when the page opens. */
  open(): Promise<{ url: string; format: 'epub' | 'pdf' | 'cbz'; mimeType: string; locator?: string; fraction?: number }>;
  engine: ReaderEngine | null;
  settings: ReaderSettings;
  onSettings(settings: ReaderSettings): void;
  onLocation(location: ReaderLocation): void;
  onClose(): void;
}

export function ReaderPage({ card, open, engine, settings, onSettings, onLocation, onClose }: ReaderPageProps) {
  const m = useMediaLook();
  const frame = useRef<ComponentRef<typeof View>>(null);
  const [book, setBook] = useState<ReaderBook | null>(null);
  const [location, setLocation] = useState<ReaderLocation | null>(null);
  const [error, setError] = useState('');
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<'' | 'contents' | 'type'>('');
  const theme = READER_THEMES[settings.theme];
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    if (!engine || !frame.current) return;
    let live = true;
    const offLocation = engine.onLocation(next => { if (live) { setLocation(next); onLocation(next); } });
    void open().then(source => engine.open(source, frame.current, settingsRef.current, source.locator))
      .then(opened => { if (live) setBook(opened); })
      .catch(reason => { if (live) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { live = false; offLocation(); engine.destroy(); };
  // The document opens once per page; settings apply separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);
  useEffect(() => { engine?.apply(settings); }, [engine, settings]);

  // The chrome steps aside a few seconds after the book opens and after each page turn.
  const hideLater = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nudge = useCallback((show: boolean) => {
    clearTimeout(hideLater.current);
    setChrome(show);
    if (show) hideLater.current = setTimeout(() => setChrome(false), 4000);
  }, []);
  useEffect(() => { if (book) nudge(true); return () => clearTimeout(hideLater.current); }, [book, nudge]);

  const turn = useCallback((direction: 'next' | 'previous') => {
    if (!engine) return;
    if (direction === 'next') engine.next(); else engine.previous();
    if (!panel) setChrome(false);
  }, [engine, panel]);

  useEffect(() => engine?.onInput(input => {
    if (input === 'next' || input === 'previous') turn(input);
    else if (input === 'toggle-chrome') { if (panel) setPanel(''); else nudge(!chrome); }
    else if (input === 'escape') { if (panel) setPanel(''); else onClose(); }
  }), [engine, turn, panel, chrome, nudge, onClose]);

  useEffect(() => {
    if (!web || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || target?.tagName === 'INPUT') return;
      const inPanel = !!target?.closest?.('[data-reader-panel]');
      if (event.key === 'Escape') { event.preventDefault(); if (panel) setPanel(''); else onClose(); return; }
      if (inPanel) return;
      if (['ArrowRight', 'PageDown'].includes(event.key) || (event.key === ' ' && !event.shiftKey && target?.getAttribute('role') !== 'button')) { event.preventDefault(); turn(book?.rtl && event.key === 'ArrowRight' ? 'previous' : 'next'); }
      else if (['ArrowLeft', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey)) { event.preventDefault(); turn(book?.rtl && event.key === 'ArrowLeft' ? 'next' : 'previous'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn, panel, onClose, book?.rtl]);

  const progress = location ? percent(location.fraction) : '';
  const bar = (style: ViewStyle) => [{ position: 'absolute', left: 0, right: 0, backgroundColor: theme.page, opacity: chrome || panel ? 1 : 0,
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: m.small ? 10 : 18, zIndex: 5 } as ViewStyle, style,
    web ? ({ transitionProperty: 'opacity', transitionDuration: '240ms' } as ViewStyle) : {}];
  return (
    <View style={{ flex: 1, backgroundColor: theme.page }} testID="reader">
      <View ref={frame} style={{ position: 'absolute', top: m.small ? 52 : 60, bottom: m.small ? 46 : 52, left: 0, right: 0 }} testID="reader-frame"
        accessibilityLabel={card.name} />
      {!engine ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', padding: 32 }} accessibilityRole="alert">
        <Text style={m.text({ 'font-size': '16px', color: theme.ink, 'text-align': 'center' })}>{msg('media.reader.unsupported')}</Text>
      </View> : null}
      {engine && !book && !error ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={m.text({ 'font-family': '"Iowan Old Style", Georgia, serif', 'font-size': '20px', 'font-style': 'italic', color: theme.quiet })}>{card.name}</Text>
      </View> : null}
      {error ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }} accessibilityRole="alert">
        <Text style={m.text({ 'font-size': '17px', color: theme.ink, 'text-align': 'center' })}>{msg('media.reader.failed')}</Text>
        <Text style={m.text({ 'font-size': '13px', color: theme.quiet, 'text-align': 'center' })}>{error}</Text>
      </View> : null}
      <View pointerEvents={chrome || panel ? 'auto' : 'none'} style={bar({ top: 0, height: m.small ? 52 : 60, borderBottomWidth: 1, borderBottomColor: theme.rule })} testID="reader-top">
        <ReaderButton icon="back" label={msg('media.ui.back')} onPress={onClose} color={theme.ink} testID="reader-close" nativeID="reader-close" />
        <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
          <Text numberOfLines={1} style={m.text({ 'font-family': '"Iowan Old Style", "Palatino Linotype", Georgia, serif', 'font-size': '15px', 'font-weight': '600', color: theme.ink })}>{book?.title || card.name}</Text>
          {location?.chapter ? <Text numberOfLines={1} style={m.text({ 'font-size': '12px', color: theme.quiet })}>{location.chapter}</Text> : null}
        </View>
        <ReaderButton icon="contents" label={msg('media.reader.contents')} onPress={() => setPanel(panel === 'contents' ? '' : 'contents')} color={theme.ink} active={panel === 'contents'} testID="reader-contents" />
        <ReaderButton icon="text" label={msg('media.reader.type')} onPress={() => setPanel(panel === 'type' ? '' : 'type')} color={theme.ink} active={panel === 'type'} testID="reader-type" />
      </View>
      <View pointerEvents={chrome || panel ? 'auto' : 'none'} style={bar({ bottom: 0, height: m.small ? 46 : 52, borderTopWidth: 1, borderTopColor: theme.rule })} testID="reader-bottom">
        <ReaderButton icon="back" label={msg('media.reader.previous')} onPress={() => turn('previous')} color={theme.ink} testID="reader-previous" />
        <ProgressTrack fraction={location?.fraction ?? 0} color={theme.ink} rule={theme.rule} onSeek={fraction => engine?.goToFraction(fraction)} />
        <Text style={m.text({ 'font-size': '12px', color: theme.quiet, 'font-variant-numeric': 'tabular-nums', 'min-width': '92px', 'text-align': 'right' })} testID="reader-progress">
          {location?.page && location.pages ? msg('media.reader.pageOf', { page: number(location.page), pages: number(location.pages) }) + ' · ' : ''}{progress}
        </Text>
        <View style={{ transform: [{ scaleX: -1 }] }}><ReaderButton icon="back" label={msg('media.reader.next')} onPress={() => turn('next')} color={theme.ink} testID="reader-next" /></View>
      </View>
      {!chrome && !panel && location ? <Text pointerEvents="none" style={[m.text({ 'font-size': '11px', color: theme.quiet }), { position: 'absolute', bottom: 14, alignSelf: 'center' }]}>{progress}</Text> : null}
      {panel ? <Panel theme={settings.theme} onClose={() => setPanel('')} title={panel === 'contents' ? msg('media.reader.contents') : msg('media.reader.type')}>
        {panel === 'contents'
          ? (book?.toc.length ? book.toc.map((item, i) => <TocRow key={`${item.href}-${i}`} item={item} theme={settings.theme} current={location?.tocHref === item.href}
              onPress={() => { engine?.goTo(item.href); setPanel(''); setChrome(false); }} />)
            : <Text style={m.text({ 'font-size': '14px', color: theme.quiet })}>{msg('media.reader.noContents')}</Text>)
          : <TypeSettings settings={settings} onChange={onSettings} />}
      </Panel> : null}
    </View>
  );
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

function Panel({ theme, title, onClose, children }: { theme: ReaderTheme; title: string; onClose(): void; children: React.ReactNode }) {
  const m = useMediaLook();
  const colours = READER_THEMES[theme];
  const width = Math.min(380, m.width - 32);
  return (
    <>
      <Pressable onPress={onClose} accessibilityLabel={msg('media.reader.closePanel')} style={[NO_RING, { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0, 0, 0, 0.18)', zIndex: 8 }]} />
      <View {...({ dataSet: { readerPanel: '1' } } as object)} style={[{ position: 'absolute', top: 0, bottom: 0, right: 0, width, backgroundColor: colours.page, zIndex: 9,
        borderLeftWidth: 1, borderLeftColor: colours.rule }, m.box({ 'box-shadow': '-24px 0px 48px -24px rgba(0, 0, 0, 0.35)' })]} accessibilityViewIsModal testID="reader-panel">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, height: 60, borderBottomWidth: 1, borderBottomColor: colours.rule }}>
          <Text accessibilityRole="header" style={m.text({ 'font-family': '"Iowan Old Style", Georgia, serif', 'font-size': '20px', color: colours.ink })}>{title}</Text>
          <ReaderButton icon="close" label={msg('media.reader.closePanel')} onPress={onClose} color={colours.ink} testID="reader-panel-close" />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 2 }}>{children}</ScrollView>
      </View>
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
      <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup">
        {(['light', 'sepia', 'dark'] as const).map(theme => (
          <Option key={theme} selected={settings.theme === theme} onPress={() => set({ theme })} colours={colours} testID={`reader-theme-${theme}`}
            swatch={READER_THEMES[theme]} label={msg(`media.reader.theme.${theme}`)} />
        ))}
      </View>
      {label(msg('media.reader.size'))}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Option label="A−" selected={false} onPress={() => set({ fontSize: Math.max(70, settings.fontSize - 10) })} colours={colours} testID="reader-smaller" small />
        <Text style={m.text({ flex: '1', 'text-align': 'center', 'font-size': '14px', color: colours.ink, 'font-variant-numeric': 'tabular-nums' })} testID="reader-size">{percent(settings.fontSize / 100)}</Text>
        <Option label="A+" selected={false} onPress={() => set({ fontSize: Math.min(220, settings.fontSize + 10) })} colours={colours} testID="reader-larger" />
      </View>
      {label(msg('media.reader.font'))}
      <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup">
        {(['serif', 'sans', 'publisher'] as const).map(font => <Option key={font} label={msg(`media.reader.font.${font}`)} selected={settings.font === font} onPress={() => set({ font })} colours={colours} testID={`reader-font-${font}`} />)}
      </View>
      {label(msg('media.reader.spacing'))}
      <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup">
        {[1.3, 1.5, 1.8].map(lineHeight => <Option key={lineHeight} label={msg(`media.reader.spacing.${lineHeight === 1.3 ? 'tight' : lineHeight === 1.5 ? 'normal' : 'loose'}`)} selected={settings.lineHeight === lineHeight} onPress={() => set({ lineHeight })} colours={colours} />)}
      </View>
      {label(msg('media.reader.layout'))}
      <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup">
        {(['paginated', 'scrolled'] as const).map(flow => <Option key={flow} label={msg(`media.reader.flow.${flow}`)} selected={settings.flow === flow} onPress={() => set({ flow })} colours={colours} testID={`reader-flow-${flow}`} />)}
      </View>
    </View>
  );
}

function Option({ label, selected, onPress, colours, swatch, testID, small = false }: {
  label: string; selected: boolean; onPress(): void; colours: (typeof READER_THEMES)[ReaderTheme]; swatch?: (typeof READER_THEMES)[ReaderTheme]; testID?: string; small?: boolean;
}) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  return (
    <Pressable {...handlers} onPress={onPress} testID={testID} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={label}
      style={[NO_RING, { flex: 1, height: swatch ? 64 : 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 4,
        backgroundColor: swatch ? swatch.page : state.hover || state.focus ? `${colours.ink}12` : `${colours.ink}08`,
        borderWidth: selected ? 2 : 1, borderColor: selected ? colours.link : colours.rule, outlineColor: colours.ink, outlineWidth: state.focus ? 2 : 0, outlineStyle: 'solid', outlineOffset: 2 } as ViewStyle]}>
      {swatch ? <Text style={m.text({ 'font-family': 'Georgia, serif', 'font-size': '20px', color: swatch.ink })}>Aa</Text> : null}
      <Text style={m.text({ 'font-size': small ? '14px' : '13px', 'font-weight': '600', color: swatch ? swatch.ink : colours.ink })}>{label}</Text>
    </Pressable>
  );
}
