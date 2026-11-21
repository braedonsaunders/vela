// Phones: every channel with what is on now and next, one tap from watching. Scrolled deep, Back
// to top (and on iOS a status-bar tap) returns to the first channel.
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { FlatList, View } from 'react-native';
import { BackToTop } from './back-to-top';
import { deepInGuide } from './navigation';
import { msg, type GuideChannel } from '@vela/core';
import type { GuideLook } from './look';
import { Glyph, Line, LogoTile, Press, Progress } from './parts';

export function NowList({
  look,
  rows,
  onWatch,
  onVisible,
  handle,
}: {
  look: GuideLook;
  rows: GuideChannel[];
  onWatch(channelId: string): void;
  onVisible(ids: string[]): void;
  handle?: Ref<{ toTop(): void }>;
}) {
  const list = useRef<FlatList<GuideChannel>>(null);
  const height = useRef(0);
  const [deep, setDeep] = useState(false);
  const toTop = () => list.current?.scrollToOffset({ offset: 0, animated: true });
  useImperativeHandle(handle, () => ({ toTop }));
  const latest = useRef({ rows, onVisible });
  latest.current = { rows, onVisible };
  const changed = useRef(({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
    const indexes = viewableItems.map(item => item.index).filter((i): i is number => typeof i === 'number');
    if (!indexes.length) return;
    const start = Math.max(0, Math.min(...indexes) - 6);
    latest.current.onVisible(latest.current.rows.slice(start, Math.max(...indexes) + 7).map(c => c.id));
  }).current;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
    <FlatList
      ref={list}
      data={rows}
      onLayout={event => { height.current = event.nativeEvent.layout.height; }}
      onScroll={event => {
        const next = deepInGuide(event.nativeEvent.contentOffset.y, height.current);
        setDeep(old => old === next ? old : next);
      }}
      scrollEventThrottle={100}
      onViewableItemsChanged={changed}
      keyExtractor={c => c.id}
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={{ paddingBottom: 24 }}
      accessibilityLabel={msg('live.onNow')}
      renderItem={({ item }) => <NowRow look={look} channel={item} onWatch={onWatch} />}
    />
    {deep ? <BackToTop look={look} onPress={toTop} /> : null}
    </View>
  );
}

function NowRow({
  look,
  channel: c,
  onWatch,
}: {
  look: GuideLook;
  channel: GuideChannel;
  onWatch(channelId: string): void;
}) {
  const now = c.now || (!c.listingsLoaded ? '' : c.listed ? msg('live.nothingNow') : msg('live.noListings'));
  return (
    <Press
      label={msg('ui.watchChannel', { channel: c.name })}
      onPress={() => onWatch(c.id)}
      style={({ pressed, focused }) => ({
        flexDirection: 'row',
        gap: 14,
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: look.hairline,
        backgroundColor: pressed ? look.cell : 'transparent',
        boxShadow: focused ? `inset 0px 0px 0px 2px ${look.accent}` : undefined,
      })}
    >
      <LogoTile look={look} logo={c.logo} name={c.name} width={76} height={48} radius={10} size={15} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Line look={look} size={12} color={look.inkQuiet} tabular>
            {c.number}
          </Line>
          <Line look={look} size={12} weight={600} color={look.inkSecondary} style={{ flexShrink: 1 }}>
            {c.name}
          </Line>
          {c.favorite ? <Glyph name="star-fill" size={9} color={look.accent} /> : null}
        </View>
        <Line look={look} size={16} weight={c.now ? 640 : 500} color={c.now ? look.ink : look.inkQuiet}>
          {now}
        </Line>
        {c.nowId ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Progress look={look} percent={c.nowProgress} height={2} flex={1} />
            <Line look={look} size={12} color={look.inkQuiet} tabular>
              {c.nowRemaining}
            </Line>
          </View>
        ) : null}
        {c.nextLabel ? (
          <Line look={look} size={12} color={look.inkQuiet}>
            {c.nextLabel}
          </Line>
        ) : null}
      </View>
    </Press>
  );
}
