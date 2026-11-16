// Phones: every channel with what is on now and next, one tap from watching.
import { FlatList, View } from 'react-native';
import { msg, type GuideChannel } from '@vela/core';
import type { GuideLook } from './look';
import { Glyph, Line, LogoTile, Press, Progress } from './parts';

export function NowList({
  look,
  rows,
  onWatch,
}: {
  look: GuideLook;
  rows: GuideChannel[];
  onWatch(channelId: string): void;
}) {
  return (
    <FlatList
      data={rows}
      keyExtractor={c => c.id}
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={{ paddingBottom: 24 }}
      accessibilityLabel={msg('live.onNow')}
      renderItem={({ item }) => <NowRow look={look} channel={item} onWatch={onWatch} />}
    />
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
  const now = c.now || (c.listed ? msg('live.nothingNow') : msg('live.noListings'));
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
          <Line look={look} size={11} color={look.inkQuiet} tabular>
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
            <Line look={look} size={11} color={look.inkQuiet} tabular>
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
