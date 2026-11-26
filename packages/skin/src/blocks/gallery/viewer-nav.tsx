import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { msg, type Card } from '@vela/core';
import { focusElement, focusTarget } from '../../escape';
import { FocusPressable } from '../../focus';
import { useHost } from '../../host';
import { holdBack } from '../../menu-key';
import { useFocusedTVKeys } from '../../tv-keys';
import { NO_RING, useInteraction } from '../../widgets/common/controls';
import { usePart } from '../listen/look';
import { dayLabel } from '../media/day';
import { MediaGlyph } from '../media/icons';
import { useMediaLook } from '../media/parts';
import { FactList, Facts } from '../media/title';
import { PhotoTouchSurface } from './photo-touch';
import { photoInfoFacts, type PhotoDirection } from './viewer-nav-model';

export interface GalleryOpenPhoto {
  (id: string, pageKey: string): void;
}
export const GalleryOpenPhotoContext = createContext<GalleryOpenPhoto | null>(null);

export interface PhotoNavigation {
  active: boolean;
  previous: boolean;
  next: boolean;
  busy: boolean;
  fullscreen: boolean;
  info: boolean;
  chrome: boolean;
  move(direction: PhotoDirection): void;
  setFullscreen(on: boolean): void;
  setInfo(on: boolean): void;
  setChrome(on: boolean): void;
  focusedControl(): boolean;
  reportFocus(id: string, focused: boolean): void;
}

export const PhotoNavigationContext = createContext<PhotoNavigation | null>(null);
export const photoImage = (card: Card) => card.thumbnail || card.backdrop || card.poster;

const CHROME_IDLE_MS = 3000;
const SURFACE_ID = 'gallery-photo-stage';
const FULLSCREEN_ID = 'gallery-photo-fullscreen';
const web = Platform.OS === 'web';

export function PhotoViewerTopBar() {
  const navigation = useContext(PhotoNavigationContext);
  if (!navigation || navigation.fullscreen) return null;
  return <PhotoDisplayControls navigation={navigation} />;
}

export function PhotoViewerNavigation({ navigation, card, ratio, children }: {
  navigation: PhotoNavigation; card: Card; ratio?: number; children: ReactNode;
}) {
  const { active, fullscreen, chrome, info, move, setInfo, setChrome, setFullscreen } = navigation;
  const [hover, setHover] = useState(false);
  const wasFullscreen = useRef(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const hide = useCallback(() => {
    clearTimeout(timeout.current);
    focusElement(SURFACE_ID);
    setChrome(false);
  }, [setChrome]);
  const reveal = useCallback(() => {
    setChrome(true);
    clearTimeout(timeout.current);
    timeout.current = setTimeout(hide, CHROME_IDLE_MS);
  }, [hide, setChrome]);

  useEffect(() => {
    if (!active || !fullscreen) return;
    reveal();
    return () => clearTimeout(timeout.current);
  }, [active, fullscreen, reveal]);
  useEffect(() => {
    if (fullscreen) { wasFullscreen.current = true; return; }
    if (!wasFullscreen.current) return;
    wasFullscreen.current = false;
    const frame = requestAnimationFrame(() => focusElement(FULLSCREEN_ID));
    return () => cancelAnimationFrame(frame);
  }, [fullscreen]);
  useEffect(() => {
    if (!active || !fullscreen) return;
    return holdBack(() => { setFullscreen(false); return true; });
  }, [active, fullscreen, setFullscreen]);

  useFocusedTVKeys(active, event => {
    if (event.eventKeyAction === 0) return;
    if (fullscreen) reveal();
    if (event.eventType === 'up' && !fullscreen) focusElement(FULLSCREEN_ID);
    else if (event.eventType === 'left') move(-1);
    else if (event.eventType === 'right') move(1);
    else if (event.eventType === 'select' && !navigation.focusedControl()) setInfo(!info);
  });

  useEffect(() => {
    if (!active || !web) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey
        || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape' && fullscreen) {
        event.preventDefault();
        setFullscreen(false);
        return;
      }
      if (event.key.toLowerCase() === 'c' && fullscreen && chrome) {
        event.preventDefault();
        hide();
        return;
      }
      const activatesSurface = (event.key === 'Enter' || event.key === ' ') && target?.id === SURFACE_ID;
      if (fullscreen && !activatesSurface) reveal();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        move(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    const pointermove = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') reveal();
    };
    window.addEventListener('keydown', keydown, true);
    if (fullscreen) {
      window.addEventListener('pointermove', pointermove, { passive: true });
    }
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('pointermove', pointermove);
    };
  }, [active, fullscreen, chrome, hide, reveal, move, setFullscreen]);

  return (
    <>
      <View style={StyleSheet.absoluteFill}
        {...(web ? { onPointerEnter: () => setHover(true), onPointerLeave: () => setHover(false) } : {})}>
        <PhotoTouchSurface key={card.id} ratio={ratio} onSwipe={move}>{children}</PhotoTouchSurface>
        {!fullscreen ? <PhotoArrows navigation={navigation} pointerInside={hover} /> : null}
        {info && !fullscreen ? <PhotoInfo card={card} /> : null}
      </View>
      {fullscreen ? <FullscreenPhoto card={card} ratio={ratio} navigation={navigation} reveal={reveal} hide={hide} /> : null}
    </>
  );
}

function PhotoButton({ id, icon, label, onPress, visible = true, disabled = false, active = false }: {
  id: string; icon: string; label: string; onPress(): void;
  visible?: boolean; disabled?: boolean; active?: boolean;
}) {
  const m = useMediaLook();
  const control = usePart('photoViewer.control');
  const { state, handlers } = useInteraction();
  const report = useContext(PhotoNavigationContext)?.reportFocus;
  useEffect(() => () => report?.(id, false), [id, report]);
  const connect = useCallback((target: ComponentRef<typeof FocusPressable> | null) => {
    if (target && web) (target as unknown as HTMLElement).title = label;
    return focusTarget(id)(target);
  }, [id, label]);
  const lit = state.focus || state.hover;
  const size = m.tv ? 50 : 44;
  return (
    <FocusPressable ref={connect} {...handlers} nativeID={id} testID={id} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress}
      onFocus={() => { handlers.onFocus(); report?.(id, true); }}
      onBlur={() => { handlers.onBlur(); report?.(id, false); }}
      style={[NO_RING, {
        width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: lit ? m.ui.controlHover : m.ui.page, borderWidth: state.focus ? 2 : 1,
        borderColor: state.focus ? m.ui.ink : m.ui.glassEdge, opacity: visible || state.focus ? 1 : 0,
      }, control.box]}>
      <MediaGlyph name={icon} size={m.tv ? 23 : 20} color={active ? m.ui.accent : m.ui.ink} />
    </FocusPressable>
  );
}

function PhotoDisplayControls({ navigation, back, reveal }: { navigation: PhotoNavigation; back?: () => void; reveal?: () => void }) {
  const { info, fullscreen, setFullscreen, setInfo } = navigation;
  const transport = usePart('photoViewer.transport');
  return (
    <View testID="gallery-photo-controls" style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, transport.box]}>
      <PhotoButton id="gallery-photo-info" icon="info" label={msg(info ? 'gallery.hideInfo' : 'gallery.showInfo')} active={info} onPress={() => { reveal?.(); setInfo(!info); }} />
      {back ? <PhotoButton id="gallery-photo-exit-fullscreen" icon="collapse" label={msg('gallery.exitFullscreen')} onPress={back} />
        : <PhotoButton id={FULLSCREEN_ID} icon={fullscreen ? 'collapse' : 'expand'} label={msg('gallery.fullscreen')} onPress={() => setFullscreen(true)} />}
    </View>
  );
}

function PhotoArrows({ navigation, pointerInside, reveal }: { navigation: PhotoNavigation; pointerInside: boolean; reveal?: () => void }) {
  const m = useMediaLook();
  const coarse = web && typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const visible = !web || coarse || m.small || m.tv || pointerInside;
  return (
    <View pointerEvents="box-none" style={{
      position: 'absolute', left: 10, right: 10, top: '50%', transform: [{ translateY: m.tv ? -25 : -22 }],
      flexDirection: 'row', justifyContent: 'space-between',
    }}>
      <View pointerEvents="box-none">
        {navigation.previous ? <PhotoButton id="gallery-photo-previous" icon="back" label={msg('gallery.previous')}
          visible={visible} disabled={navigation.busy} onPress={() => { reveal?.(); navigation.move(-1); }} /> : null}
      </View>
      <View pointerEvents="box-none">
        {navigation.next ? <PhotoButton id="gallery-photo-next" icon="forward" label={msg('gallery.next')}
          visible={visible} disabled={navigation.busy} onPress={() => { reveal?.(); navigation.move(1); }} /> : null}
      </View>
    </View>
  );
}

function FullscreenPhoto({ card, ratio, navigation, reveal, hide }: {
  card: Card; ratio?: number; navigation: PhotoNavigation; reveal(): void; hide(): void;
}) {
  const host = useHost();
  const m = useMediaLook();
  const stage = usePart('photoViewer.stage');
  const lastTouch = useRef(0);
  const toggle = navigation.chrome ? hide : reveal;
  const uri = photoImage(card);
  const top = host.viewport.insets.top + (m.tv ? 24 : 16);
  const right = (host.viewport.sides?.right ?? 0) + (m.tv ? 28 : 16);
  const left = host.viewport.sides?.left ?? 0;
  const back = () => navigation.setFullscreen(false);

  return (
    <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={back}
      onShow={() => { focusElement(SURFACE_ID); }}>
      <View style={{ flex: 1, backgroundColor: m.ui.page }} testID="gallery-photo-fullscreen-stage">
        <FocusPressable ref={focusTarget(SURFACE_ID)} nativeID={SURFACE_ID} testID={SURFACE_ID} accessibilityRole="button"
          {...(web ? { dataSet: { velaFocus: 'frame' } } : {})}
          accessibilityLabel={msg(navigation.chrome ? 'gallery.hideControls' : 'gallery.showControls')}
          hasTVPreferredFocus={Platform.isTV} onPress={() => {
            if (!Platform.isTV && Date.now() - lastTouch.current > 350) toggle();
          }} style={[StyleSheet.absoluteFill, NO_RING, stage.box]}>
          <PhotoTouchSurface key={card.id} ratio={ratio} onTap={toggle} onTouch={() => { lastTouch.current = Date.now(); }}
            onSwipe={direction => { reveal(); navigation.move(direction); }}>
            {uri ? <Image source={host.image(uri)} contentFit="contain" accessibilityLabel={card.name} style={StyleSheet.absoluteFill} /> : null}
          </PhotoTouchSurface>
        </FocusPressable>
        {navigation.chrome ? <>
          <View pointerEvents="box-none" style={{ position: 'absolute', right, top }}>
            <PhotoDisplayControls navigation={navigation} back={back} reveal={reveal} />
          </View>
          <View style={[StyleSheet.absoluteFill, { left, right: host.viewport.sides?.right ?? 0 }]} pointerEvents="box-none">
            <PhotoArrows navigation={navigation} pointerInside reveal={reveal} />
          </View>
        </> : null}
        {navigation.info ? (
          <PhotoInfo card={card} style={{
            top: top + (m.tv ? 62 : 56), right,
            width: Math.min(360, m.width - 32), maxHeight: m.height - top - 96 - host.viewport.insets.bottom,
          }} />
        ) : null}
      </View>
    </Modal>
  );
}

function PhotoInfo({ card, style }: { card: Card; style?: ViewStyle }) {
  const m = useMediaLook();
  const facts = usePart('photoViewer.facts');
  const date = dayLabel(card);
  const entries = photoInfoFacts(card.media?.facts ?? [], card.airDate);
  const withFacts = card.media ? { ...card, media: { ...card.media, facts: entries } } : card;
  return (
    <ScrollView testID="gallery-photo-info-panel" style={[
      { position: 'absolute', top: 12, right: 12, width: Math.min(320, m.width - (m.small ? 64 : 100)), maxWidth: '92%', maxHeight: '86%',
        borderRadius: 12, backgroundColor: m.ui.page, borderColor: m.ui.glassEdge, borderWidth: 1 }, style,
    ]} contentContainerStyle={{ padding: m.tv ? 22 : 16, gap: 8 }}>
      <Text accessibilityRole="header" style={m.text({ 'font-size': m.tv ? '24px' : '20px', 'font-weight': '650', color: '$ui.ink' })}>{card.name}</Text>
      {date ? <Facts items={[date]} /> : null}
      <FactList card={withFacts} style={{ marginTop: 4, marginBottom: 0, ...facts.box }} />
    </ScrollView>
  );
}
