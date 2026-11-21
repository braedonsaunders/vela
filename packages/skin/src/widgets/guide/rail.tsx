// A channel's cell in the guide's rail: number, logo on its neutral tile, name, favourite star and
// how far the programme on now has run. Pressing it watches the channel.
import { Platform, View } from 'react-native';
import { memo, useMemo, useSyncExternalStore } from 'react';
import { msg, type GuideChannel } from '@vela/core';
import { railId } from './geometry';
import type { GuideLook } from './look';
import { Glyph, Line, LogoTile, Press, Progress } from './parts';
import { useLiveContext } from './live';

interface RailProps {
  look: GuideLook;
  channel: GuideChannel;
  small: boolean;
  width: number;
  row: number;
  selected: boolean;
  onWatch(channelId: string): void;
}

export const RailCell = memo(function RailCell({ look, channel, small, width, row, selected, onWatch }: RailProps) {
  return (
    <Press
      nativeID={railId(channel.id)}
      label={msg('ui.watchChannel', { channel: channel.name })}
      onPress={() => onWatch(channel.id)}
      // On TV the focus engine walks the programmes; the rail stays a pointer and touch target.
      focusable={!Platform.isTV}
      style={({ hovered, focused }) => ({
        width,
        height: row,
        flexDirection: 'row',
        alignItems: 'center',
        gap: small ? 0 : 12,
        justifyContent: small ? 'center' : 'flex-start',
        paddingLeft: small ? 8 : 16,
        paddingRight: small ? 8 : 14,
        borderBottomWidth: 1,
        borderBottomColor: look.hairline,
        backgroundColor: selected || hovered ? look.railOn : look.rail,
        boxShadow: focused ? `inset 0px 0px 0px 2px ${look.accent}` : undefined,
      })}
    >
      {!small ? (
        <Line
          look={look}
          size={12}
          color={look.inkQuiet}
          tabular
          // Five digits (a 10,000-channel lineup) or a sub-channel like 100.12 fit before ellipsis.
          style={{ width: 42, textAlign: 'right', flexShrink: 0 }}
        >
          {channel.number}
        </Line>
      ) : null}
      <View>
        <LogoTile
          look={look}
          channelId={channel.id}
          logo={channel.logo}
          name={channel.name}
          width={small ? 64 : 58}
          height={small ? 40 : 36}
        />
        {small ? (
          <Line
            look={look}
            size={12}
            weight={700}
            tabular
            style={{ position: 'absolute', right: 3, bottom: 2, textShadowColor: look.shadow, textShadowRadius: 3 }}
          >
            {channel.number}
          </Line>
        ) : null}
      </View>
      {!small ? <RailText look={look} channel={channel} /> : null}
    </Press>
  );
});

function RailText({ look, channel: original }: { look: GuideLook; channel: GuideChannel }) {
  const live = useLiveContext();
  const read = useMemo(() => {
    let index = -1;
    return () => {
      const rows = live?.controller.view().guide?.channels;
      if (rows?.[index]?.id !== original.id) index = rows?.findIndex(row => row.id === original.id) ?? -1;
      return rows?.[index] ?? original;
    };
  }, [live?.controller, original]);
  // Only clock text/progress subscribes; the recycled row and logo never redraw for a minute.
  const channel = useSyncExternalStore(live?.controller.subscribe ?? (() => () => {}), read, read);
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
      <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
        <Line look={look} size={14} weight={620} lines={2} style={{ flexShrink: 1 }}>
          {channel.name}
        </Line>
        {channel.favorite ? (
          <View accessibilityLabel={msg('live.favourite')} accessible>
            <Glyph name="star-fill" size={10} color={look.accent} />
          </View>
        ) : null}
      </View>
      {/* The airing programme's own cell says how long is left; the rail keeps the channel's
          name whole and shows only how far along it is. */}
      {channel.nowId ? (
        <View style={{ marginTop: 3 }}>
          <Progress look={look} percent={channel.nowProgress} height={2} />
        </View>
      ) : (
        <Line look={look} size={12} color={look.inkQuiet}>
          {!channel.listingsLoaded || channel.listed ? channel.group : msg('live.noListings')}
        </Line>
      )}
    </View>
  );
}
