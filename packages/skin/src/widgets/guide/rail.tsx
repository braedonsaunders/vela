// A channel's cell in the guide's rail: number, logo on its neutral tile, name, favourite star and
// how far the programme on now has run. Pressing it watches the channel.
import { Platform, View } from 'react-native';
import { msg, type GuideChannel } from '@vela/core';
import { railId } from './geometry';
import type { GuideLook } from './look';
import { Glyph, Line, LogoTile, Press, Progress } from './parts';

interface RailProps {
  look: GuideLook;
  channel: GuideChannel;
  small: boolean;
  width: number;
  row: number;
  selected: boolean;
  onWatch(channelId: string): void;
}

export function RailCell({ look, channel, small, width, row, selected, onWatch }: RailProps) {
  return (
    <Press
      nativeID={railId(channel.id)}
      label={msg('ui.watchChannel', { channel: channel.name })}
      onPress={() => onWatch(channel.id)}
      // On TV the focus engine walks the programmes; the rail stays a pointer and touch target.
      focusable={!Platform.isTV}
      style={({ hovered, focused }) => ({
        width, height: row - 1, flexDirection: 'row', alignItems: 'center', gap: small ? 0 : 12,
        justifyContent: small ? 'center' : 'flex-start', paddingLeft: small ? 8 : 16, paddingRight: small ? 8 : 14,
        borderRightWidth: 1, borderRightColor: look.edge,
        backgroundColor: selected || hovered ? look.railOn : look.rail,
        boxShadow: focused ? `inset 0px 0px 0px 2px ${look.accent}` : undefined,
      })}
    >
      {!small ? (
        <Line look={look} size={12} color={look.inkQuiet} tabular style={{ width: 34, textAlign: 'right', flexShrink: 0 }}>
          {channel.number}
        </Line>
      ) : null}
      <View>
        <LogoTile look={look} logo={channel.logo} name={channel.name} width={small ? 64 : 58} height={small ? 40 : 36} />
        {small ? (
          <Line look={look} size={9} weight={700} tabular style={{ position: 'absolute', right: 3, bottom: 2, textShadowColor: look.shadow, textShadowRadius: 3 }}>
            {channel.number}
          </Line>
        ) : null}
      </View>
      {!small ? <RailText look={look} channel={channel} /> : null}
    </Press>
  );
}

function RailText({ look, channel }: { look: GuideLook; channel: GuideChannel }) {
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
      <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
        <Line look={look} size={14} weight={620} style={{ flexShrink: 1 }}>{channel.name}</Line>
        {channel.favorite ? (
          <View accessibilityLabel={msg('live.favourite')} accessible>
            <Glyph name="star-fill" size={10} color={look.accent} />
          </View>
        ) : null}
      </View>
      {channel.nowId ? (
        <>
          <View style={{ marginTop: 3 }}><Progress look={look} percent={channel.nowProgress} height={2} /></View>
          <Line look={look} size={11} color={look.inkQuiet} tabular>{channel.nowRemaining}</Line>
        </>
      ) : (
        <Line look={look} size={11} color={look.inkQuiet}>{channel.listed ? channel.group : msg('live.noListings')}</Line>
      )}
    </View>
  );
}
