// One channel's row on the timeline: the programmes near the visible time, or, for a channel
// without listings, one wide "No listings · Watch live" button that stays in view.
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { msg, type GuideChannel, type GuideProgramme } from '@vela/core';
import { ProgrammeCell } from './cell';
import type { GuideLook } from './look';
import { Line, Press } from './parts';

interface RowProps {
  look: GuideLook;
  channel: GuideChannel;
  scale: number;
  row: number;
  small: boolean;
  width: number;
  /** Minutes to draw programmes over. */
  window: { from: number; to: number };
  visibleWidth: number;
  nowMinute: number;
  selectedProgramme: string;
  scrollX: SharedValue<number>;
  onFocus(channel: GuideChannel, programme: GuideProgramme | null): void;
  onPress(channel: GuideChannel, programme: GuideProgramme): void;
  onKey(channel: GuideChannel, programme: GuideProgramme, key: string, prevent: () => void): void;
  onWatch(channelId: string): void;
}

export function TimelineRow(props: RowProps) {
  const { look, channel, scale, row, width, window } = props;
  const near = channel.programmes.filter(p => p.at + p.span > window.from && p.at < window.to);
  return (
    <View style={{ width, height: row, borderBottomWidth: 1, borderBottomColor: look.hairline }}>
      {!channel.listed ? <NoListings {...props} /> : null}
      {near.map(p => (
        <ProgrammeCell
          key={p.id}
          look={look}
          programme={p}
          channel={channel}
          scale={scale}
          row={row}
          small={props.small}
          nowMinute={props.nowMinute}
          selected={p.id === props.selectedProgramme}
          scrollX={props.scrollX}
          onFocus={props.onFocus}
          onPress={props.onPress}
          onKey={props.onKey}
        />
      ))}
    </View>
  );
}

function NoListings({ look, channel, row, visibleWidth, scrollX, onWatch, onFocus }: RowProps) {
  const follow = useAnimatedStyle(() => ({ transform: [{ translateX: scrollX.value }] }));
  return (
    <Animated.View
      style={[
        { position: 'absolute', left: 6, top: 6, height: row - 13, width: Math.max(120, visibleWidth - 12) },
        follow,
      ]}
    >
      <Press
        label={msg('ui.watchChannel', { channel: channel.name })}
        onPress={() => onWatch(channel.id)}
        onFocus={() => onFocus(channel, null)}
        style={({ hovered, focused }) => ({
          flex: 1,
          flexDirection: 'row',
          gap: 10,
          alignItems: 'center',
          paddingLeft: 16,
          borderRadius: look.radiusCell,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: look.edge,
          backgroundColor: hovered ? look.cell : 'transparent',
          boxShadow: focused ? `inset 0px 0px 0px 2px ${look.accent}` : undefined,
        })}
      >
        <Line look={look} size={13} color={look.inkQuiet}>
          {msg('live.noListings')}
        </Line>
        <Line look={look} size={13} color={look.inkQuiet}>
          ·
        </Line>
        <Line look={look} size={13} weight={600} color={look.inkSecondary}>
          {msg('live.watch')}
        </Line>
      </Press>
    </Animated.View>
  );
}
