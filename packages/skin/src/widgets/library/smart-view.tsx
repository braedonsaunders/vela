import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import type { Card } from '@vela/core';
import { FocusPressable } from '../../focus';
import { useHost, type WidgetProps } from '../../host';
import { useLook } from '../common/look';
import { timelineGroups, watchedTime } from './timeline';

function WatchState({ card }: { card: Card }) {
  const look = useLook();
  const progress = card.durationSeconds > 0 ? Math.min(1, Math.max(0, card.progressSeconds / card.durationSeconds)) : 0;
  if (card.played) return <Text style={look.text({ color: '$ui.inkSecondary', 'font-size': '12px', 'font-weight': '600' })}>✓ Watched</Text>;
  if (!progress) return null;
  return <View accessibilityLabel={`${Math.round(progress * 100)}% watched`} style={{ width: 92, gap: 4 }}>
    <View style={look.box({ height: '3px', 'border-radius': '2px', 'background-color': '$ui.trackStrong', 'overflow-x': 'hidden', 'overflow-y': 'hidden' })}>
      <View style={[look.box({ height: '3px', 'background-color': '$ui.accent' }), { width: `${progress * 100}%` }]} />
    </View>
    <Text style={look.text({ color: '$ui.inkSecondary', 'font-size': '11px' })}>{Math.round(progress * 100)}% watched</Text>
  </View>;
}

function SmartRow({ card, timeline = false }: { card: Card; timeline?: boolean }) {
  const host = useHost();
  const look = useLook();
  const [focused, setFocused] = useState(false);
  const small = !!host.env.small;
  const width = small ? 104 : 148;
  const height = Math.round(width * 9 / 16);
  const art = card.thumbnail || card.backdrop || card.poster;
  const subtitle = card.episodeContext || card.summary;
  const watched = timeline && card.lastViewedAt ? watchedTime(card.lastViewedAt) : '';
  return <FocusPressable testID={`smart-view-${card.id}`} accessibilityRole="button" accessibilityLabel={[card.name, subtitle, card.yearLabel, watched].filter(Boolean).join(', ')}
    onFocus={event => {
      setFocused(true);
      if (Platform.OS === 'web') (event.currentTarget as unknown as HTMLElement).scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }}
    onBlur={() => setFocused(false)} onPress={() => host.dispatch('select', `${card.id}|${card.kind}|${card.receipt}`)}
    style={look.box({ display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: small ? '12px' : '18px', padding: small ? '10px' : '12px',
      'border-radius': '$ui.radiusPanel', 'background-color': focused ? '$ui.controlHover' : '$ui.raised', border: `1px solid ${focused ? '$ui.accent' : '$ui.glassEdge'}`,
      'box-shadow': focused ? '0px 0px 0px 2px $ui.accent' : '0px 10px 28px -22px $ui.shadow' })}>
    <View style={[look.box({ 'border-radius': '$ui.radiusCard', 'background-color': '$ui.control', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'flex-shrink': '0' }), { width, height }]}>
      {art ? <Image source={host.image(art)} contentFit="cover" style={{ width, height }} accessibilityElementsHidden />
        : <View style={[look.box({ 'background-color': '$ui.control' }), { width, height }]} />}
      {card.played && <View style={[look.box({ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', 'border-radius': '11px', 'background-color': '$ui.glass', 'align-items': 'center', 'justify-content': 'center' }), { position: 'absolute' }]}>
        <Text style={look.text({ color: '$ui.ink', 'font-size': '12px', 'font-weight': '800' })}>✓</Text>
      </View>}
    </View>
    <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
      <Text numberOfLines={1} style={look.text({ color: '$ui.ink', 'font-size': small ? '15px' : '17px', 'font-weight': '650' })}>{card.name}</Text>
      {!!subtitle && <Text numberOfLines={1} style={look.text({ color: '$ui.inkSecondary', 'font-size': '13px' })}>{subtitle}</Text>}
      {!!card.yearLabel && <Text numberOfLines={1} style={look.text({ color: '$ui.inkSecondary', 'font-size': '12px', 'font-variant-numeric': 'tabular-nums' })}>{card.yearLabel}</Text>}
    </View>
    <View style={{ flexShrink: 0, alignItems: 'flex-end', gap: 6 }}>
      {!!watched && <Text style={look.text({ color: '$ui.inkSecondary', 'font-size': '12px' })}>{watched}</Text>}
      <WatchState card={card} />
    </View>
  </FocusPressable>;
}

export function LibrarySmartView(_props: WidgetProps) {
  const host = useHost();
  const look = useLook();
  const page = host.env.library;
  const items = page?.model?.items ?? [];
  const layout = page?.layout ?? 'grid';
  const groups = useMemo(() => timelineGroups(items), [items]);
  const side = host.env.small ? 14 : 32;
  if (layout === 'list') return <View testID="smart-view-list" style={{ paddingHorizontal: side, gap: 8 }}>
    {items.map(card => <SmartRow key={card.id} card={card} />)}
  </View>;
  if (layout !== 'timeline') return null;
  return <View testID="smart-view-timeline" style={{ gap: 18 }}>
    {groups.map(group => <View key={group.key} style={{ gap: 8 }}>
      <View style={[look.box({ 'background-color': '$ui.page', 'border-bottom-width': '1px', 'border-bottom-color': '$ui.glassEdge', 'z-index': '3' }),
        { position: Platform.OS === 'web' ? 'sticky' as never : 'relative', top: Platform.OS === 'web' ? look.ui.controlHeight + 22 : undefined, paddingHorizontal: side, paddingVertical: 8 }]}>
        <Text accessibilityRole="header" aria-level={2} style={look.text({ color: '$ui.ink', 'font-size': '16px', 'font-weight': '700' })}>{group.label}</Text>
      </View>
      <View style={{ paddingHorizontal: side, gap: 8 }}>{group.items.map(card => <SmartRow key={card.id} card={card} timeline />)}</View>
    </View>)}
  </View>;
}
