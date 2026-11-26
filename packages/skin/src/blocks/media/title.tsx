import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { ScrollView, Text, View, type ViewStyle } from 'react-native';
import { msg, type Card } from '@vela/core';
import { useHost } from '../../host';
import { useMediaActions, type MediaActions } from './context';
import { alpha, RoundButton, useMediaLook, type MediaLook } from './parts';

/** The page: its colour wash from the cover, a blurred cover behind the hero, the back control.
 * Framed, the document's title frame is the page: the wash and the content scroll in its region
 * and the frame's own close control closes it. */
export function MediaFrame({ framed, accent, backdrop, wideArt, children }: { framed: boolean; accent: string; backdrop: string; wideArt: boolean; children: ReactNode }) {
  const host = useHost();
  const m = useMediaLook();
  const actions = useMediaActions();
  const tint = accent || m.ui.accent;
  const top = m.tv ? 32 : Math.max(16, host.viewport.insets.top + 12);
  const wash = (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: wideArt ? Math.min(640, m.height * 0.8) : 620, overflow: 'hidden' }}>
      {backdrop ? <Image source={host.image(backdrop)} contentFit="cover" blurRadius={wideArt ? 0 : 70} transition={framed ? 240 : 0}
        style={{ position: 'absolute', top: wideArt ? 0 : -80, left: wideArt ? 0 : -80, right: wideArt ? 0 : -80, bottom: 0, opacity: wideArt ? 0.6 : 0.42 } as never} /> : null}
      <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
        m.box({ 'background-image': `linear-gradient(180deg, ${alpha(tint, 0.34)} 0%, ${alpha(m.ui.page, 0.55)} 55%, ${m.ui.page} 100%)` })]} />
    </View>
  );
  if (framed) return (
    // A phone's frame is full-bleed under the shell's bar, its close control at the region's top.
    <View testID="media-page" style={{ position: 'relative' }}>
      {wash}
      <View testID="media-scroll" style={{ paddingTop: m.tv ? 72 : m.small ? host.viewport.insets.top + 56 + 72 : 72, paddingBottom: 24, paddingHorizontal: m.gutter, maxWidth: 1360, width: '100%', alignSelf: 'center' } as ViewStyle}>{children}</View>
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: m.ui.page }} testID="media-page">
      {wash}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: top + 56, paddingBottom: 140 }} testID="media-scroll">
        <View style={{ paddingHorizontal: m.gutter, maxWidth: 1360, width: '100%', alignSelf: 'center' } as ViewStyle}>{children}</View>
      </ScrollView>
      <View style={{ position: 'absolute', top, left: m.gutter - 6 }}>
        <RoundButton icon="back" label={msg('media.ui.back')} onPress={actions.back} nativeID="detail-close" testID="detail-close" size={42} />
      </View>
    </View>
  );
}

export function Hero({ cover, children }: { cover: ReactNode; children: ReactNode }) {
  const m = useMediaLook();
  return (
    <View style={{ flexDirection: m.small ? 'column' : 'row', alignItems: m.small ? 'center' : 'flex-end', gap: m.small ? 24 : 44, marginBottom: m.small ? 32 : 48 }}>
      {cover}
      <View style={{ flex: m.small ? undefined : 1, alignSelf: 'stretch', justifyContent: 'flex-end', gap: 12, minWidth: 0 }}>{children}</View>
    </View>
  );
}

export function Eyebrow({ children }: { children: string }) {
  const m = useMediaLook();
  return <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.2em', 'text-transform': 'uppercase', color: '$ui.inkSecondary' })}>{children}</Text>;
}

export function Title({ children }: { children: string }) {
  const m = useMediaLook();
  const size = m.small ? 36 : m.wide ? (children.length > 28 ? 52 : 64) : 46;
  return <Text accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': `${size}px`, 'line-height': '1.02', 'letter-spacing': '-0.015em', color: '$ui.ink' })}>{children}</Text>;
}

export function Facts({ items }: { items: string[] }) {
  const m = useMediaLook();
  const line = items.filter(Boolean).join('  ·  ');
  return line ? <Text style={m.text({ 'font-size': '14px', color: '$ui.inkSecondary' })}>{line}</Text> : null;
}

export function Summary({ text, serif = false }: { text: string; serif?: boolean }) {
  const m = useMediaLook();
  if (!text) return null;
  return <Text style={m.text({ 'font-size': serif ? '17px' : '15px', 'line-height': '1.6', color: '$ui.inkSecondary', 'max-width': '760px',
    ...(serif ? { 'font-family': '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif' } : {}) })}>{text}</Text>;
}

export function Buttons({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>{children}</View>;
}

export function openByline(card: Card, actions: MediaActions): (() => void) | undefined {
  const target = card.media?.bylineTarget ?? '';
  if (target.startsWith('title:')) return () => actions.openTitle({ id: target.slice(6), kind: 'artist' });
  if (target.startsWith('person:')) return () => actions.openPerson(target.slice(7), card.media?.byline ?? '');
  return undefined;
}

export function tilesPerRow(m: MediaLook, min: number): { size: number; gap: number } {
  const gap = m.small ? 16 : 24;
  const inner = Math.min(1360, m.width) - m.gutter * 2;
  const count = Math.max(2, Math.floor((inner + gap) / (min + gap)));
  return { size: Math.floor((inner - gap * (count - 1)) / count), gap };
}

export function FactList({ card }: { card: Card }) {
  const m = useMediaLook();
  const facts = card.media?.facts ?? [];
  if (!facts.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 40, rowGap: 14, marginBottom: 48 }}>
      {facts.map(fact => (
        <View key={fact.label} style={{ gap: 3, minWidth: 140 }}>
          <Text style={m.text({ 'font-size': '11px', 'font-weight': '700', 'letter-spacing': '0.16em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' })}>{fact.label}</Text>
          <Text style={m.text({ 'font-size': '14px', color: '$ui.inkSecondary' })}>{fact.value}</Text>
        </View>
      ))}
    </View>
  );
}

