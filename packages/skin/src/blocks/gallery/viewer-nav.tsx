import { createContext, useEffect, useRef, type ReactNode } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { Image } from 'expo-image';
import { msg, type Card } from '@vela/core';
import { focusElement, focusTarget } from '../../escape';
import { FocusPressable } from '../../focus';
import { useHost } from '../../host';
import { holdBack } from '../../menu-key';
import { NO_RING } from '../../widgets/common/controls';
import { useFocusedTVKeys } from '../../tv-keys';
import { usePart } from '../listen/look';
import { dayLabel } from '../media/day';
import { PillButton, useMediaLook } from '../media/parts';
import { FactList, Facts } from '../media/title';
import { photoSwipe, type PhotoDirection } from './viewer-nav-model';

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
}

/** Omitted on a photo opened without a Gallery session. */
export const PhotoNavigationContext = createContext<PhotoNavigation | null>(null);

export const photoImage = (card: Card) => card.thumbnail || card.backdrop || card.poster;

function usePhotoSwipe(onMove: (direction: PhotoDirection) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  return {
    swiped,
    handlers: {
      onTouchStart(event: GestureResponderEvent) {
        const { touches } = event.nativeEvent;
        const touch = touches[0];
        start.current = touches.length === 1 && touch ? { x: touch.pageX, y: touch.pageY } : null;
        swiped.current = false;
      },
      onTouchCancel() { start.current = null; },
      onTouchEnd(event: GestureResponderEvent) {
        const touch = event.nativeEvent.changedTouches[0];
        const from = start.current;
        start.current = null;
        if (!from || !touch) return;
        const direction = photoSwipe(from, { x: touch.pageX, y: touch.pageY });
        if (direction) {
          swiped.current = true;
          onMove(direction);
        }
      },
    },
  };
}

export function PhotoViewerNavigation({ navigation, card, children }: {
  navigation: PhotoNavigation; card: Card; children: ReactNode;
}) {
  const { active, fullscreen, chrome, move, setChrome, setFullscreen } = navigation;
  const restore = useRef(false);
  const toggle = () => setChrome(!chrome);
  useEffect(() => {
    if (fullscreen) { restore.current = true; return; }
    if (!restore.current) return;
    restore.current = false;
    const frame = requestAnimationFrame(() => focusElement('gallery-photo-fullscreen'));
    return () => cancelAnimationFrame(frame);
  }, [fullscreen]);
  const inline = usePhotoSwipe(move);
  useEffect(() => {
    if (!active || !fullscreen) return;
    return holdBack(() => { setFullscreen(false); return true; });
  }, [active, fullscreen, setFullscreen]);
  useFocusedTVKeys(active, event => {
    if (event.eventKeyAction === 0) return;
    if (event.eventType === 'left') move(-1);
    else if (event.eventType === 'right') move(1);
  });
  useEffect(() => {
    if (!active || Platform.OS !== 'web') return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey
        || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape' && fullscreen) {
        event.preventDefault();
        setFullscreen(false);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        move(event.key === 'ArrowLeft' ? -1 : 1);
      } else if (event.key.toLowerCase() === 'c' && fullscreen) {
        event.preventDefault();
        setChrome(!chrome);
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [active, fullscreen, chrome, move, setChrome, setFullscreen]);

  return (
    <>
      <View {...inline.handlers}>
        {!fullscreen ? <PhotoControls navigation={navigation} /> : null}
        {!fullscreen && navigation.info ? <PhotoInfo card={card} /> : null}
        {children}
      </View>
      {fullscreen ? <FullscreenPhoto card={card} navigation={navigation} toggle={toggle} /> : null}
    </>
  );
}

function PhotoControls({ navigation }: { navigation: PhotoNavigation }) {
  const { fullscreen, info, previous, next, busy, move, setFullscreen, setInfo } = navigation;
  const m = useMediaLook();
  const transport = usePart('photoViewer.transport');
  const control = usePart('photoViewer.control');
  const button = { compact: m.small, style: control.box, labelStyle: control.text };
  return (
    <View testID="gallery-photo-controls" style={[{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 10 }, transport.box]}>
      <PillButton {...button} label={msg('gallery.previous')} onPress={() => move(-1)} disabled={!previous || busy}
        testID="gallery-photo-previous" icon="previous" />
      <PillButton {...button} label={msg('gallery.next')} onPress={() => move(1)} disabled={!next || busy}
        testID="gallery-photo-next" icon="next" />
      <PillButton {...button} label={msg(info ? 'gallery.hideInfo' : 'gallery.showInfo')} onPress={() => setInfo(!info)} testID="gallery-photo-info" />
      <PillButton {...button} label={msg(fullscreen ? 'gallery.exitFullscreen' : 'gallery.fullscreen')} onPress={() => setFullscreen(!fullscreen)}
        nativeID="gallery-photo-fullscreen" testID="gallery-photo-fullscreen" />
    </View>
  );
}

function FullscreenPhoto({ card, navigation, toggle }: { card: Card; navigation: PhotoNavigation; toggle(): void }) {
  const host = useHost();
  const m = useMediaLook();
  const stage = usePart('photoViewer.stage');
  const swipe = usePhotoSwipe(navigation.move);
  const uri = photoImage(card);
  useEffect(() => {
    if (navigation.chrome) return;
    const frame = requestAnimationFrame(() => focusElement('gallery-photo-stage'));
    return () => cancelAnimationFrame(frame);
  }, [navigation.chrome]);

  return (
    <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={() => navigation.setFullscreen(false)}
      onShow={() => { focusElement('gallery-photo-stage'); }}>
      <View style={{ flex: 1, backgroundColor: m.ui.page }} testID="gallery-photo-fullscreen-stage">
        <FocusPressable ref={focusTarget('gallery-photo-stage')}
          {...swipe.handlers} nativeID="gallery-photo-stage" accessibilityRole="button"
          {...(Platform.OS === 'web' ? { dataSet: { velaFocus: 'frame' } } : {})}
          accessibilityLabel={msg(navigation.chrome ? 'gallery.hideControls' : 'gallery.showControls')}
          hasTVPreferredFocus={Platform.isTV} onPress={() => {
            if (!swipe.swiped.current) toggle();
            swipe.swiped.current = false;
          }} style={[StyleSheet.absoluteFill, NO_RING, stage.box]}>
          {uri ? <Image source={host.image(uri)} contentFit="contain" accessibilityLabel={card.name} style={StyleSheet.absoluteFill} /> : null}
        </FocusPressable>
        {navigation.chrome ? (
          <View pointerEvents="box-none" style={{
            position: 'absolute', left: m.gutter, right: m.gutter, bottom: Math.max(16, host.viewport.insets.bottom),
            alignItems: 'center',
          }}>
            <View style={{ backgroundColor: m.ui.page, borderRadius: 12, paddingHorizontal: 12 }}>
              <PhotoControls navigation={navigation} />
            </View>
          </View>
        ) : null}
        {navigation.info && navigation.chrome ? (
          <ScrollView style={{
            position: 'absolute', top: Math.max(16, host.viewport.insets.top), right: m.gutter,
            width: Math.min(360, m.width - m.gutter * 2), maxHeight: m.height * 0.72, borderRadius: 12, backgroundColor: m.ui.page,
          }} contentContainerStyle={{ padding: 18 }}>
            <PhotoInfo card={card} />
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}


function PhotoInfo({ card }: { card: Card }) {
  const m = useMediaLook();
  const facts = usePart('photoViewer.facts');
  return (
    <View style={{ paddingBottom: 14 }} testID="gallery-photo-info-panel">
      <Text accessibilityRole="header" style={m.text({ 'font-size': '22px', 'font-weight': '650', color: '$ui.ink' })}>{card.name}</Text>
      <Facts items={[dayLabel(card)]} />
      <FactList card={card} style={{ marginBottom: 0, ...facts.box }} />
    </View>
  );
}
