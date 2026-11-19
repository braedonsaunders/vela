// One channel's row on the timeline: the programmes near the visible time, or, for a channel
// without listings, one wide "No listings · Watch live" button that stays in view.
import { rowContentKey } from './content';
import { programmeGap, gapId } from './geometry';
import { ProgrammeSlots } from './navigation';
import { memo, useMemo, useRef } from 'react';
import { useLiveContext } from './live';
import { rowDrawing } from './drawing';
import { Platform, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { msg, type GuideChannel, type GuideProgramme } from '@vela/core';
import { ProgrammeCell } from './cell';
import { guideRender } from './diagnostics';
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
  window: { from: number; to: number; left: number };
  visibleWidth: number;
  visibleHeight: number;
  rowTop: number;
  scrollY: SharedValue<number>;
  nowMinute: number;
  selectedProgramme: string;
  selectedChannel: boolean;
  selectedMinute: number;
  scrollX: SharedValue<number>;
  onFocus(channel: GuideChannel, programme: GuideProgramme | null): void;
  onPress(channel: GuideChannel, programme: GuideProgramme): void;
  onKey(channel: GuideChannel, programme: GuideProgramme | null, key: string, prevent: () => void): void;
  onWatch(channelId: string): void;
}

export const TimelineRow = memo(function TimelineRow(props: RowProps) {
  guideRender('row');
  const { look, channel, scale, row, width, window } = props;
  const slots = useRef(new ProgrammeSlots()).current;
  const near = channel.listingsUnavailable ? [] : channel.programmes.filter(p => p.at + p.span > window.from && p.at < window.to);
  const Drawing = useLiveContext()?.GuideRow;
  const drawing = useMemo(() => { if (!Drawing) return; guideRender('drawing'); return rowDrawing(channel, near, scale, row, window, props.nowMinute, look, props.small); },
    [Drawing, channel, scale, row, window, look, props.small]);
  const gap = props.selectedChannel && !props.selectedProgramme && channel.listingsLoaded && channel.listed && !channel.listingsUnavailable
    ? programmeGap(channel, props.selectedMinute, width / scale) : undefined;
  const keys = Platform.isTV ? slots.keys(near.map(p => p.id)) : [];
  return (
    <View style={{ width, height: row, borderBottomWidth: 1, borderBottomColor: look.hairline }}>
      {!channel.listingsLoaded && !channel.listingsUnavailable ? <View pointerEvents="none" style={{ position: 'absolute', left: Math.max(0, window.from) * scale, width: Math.max(0, window.to - Math.max(0, window.from)) * scale, top: 5, height: row - 11, backgroundColor: look.cell, opacity: 0.5 }} /> : null}
      {channel.listingsUnavailable || channel.listingsLoaded && !channel.listed ? <NoListings {...props} /> : null}
      {gap ? <GapCell {...props} gap={gap} /> : null}
      {Drawing && drawing ? <Drawing drawing={drawing} selected={props.selectedProgramme}
        style={{ position: 'absolute', left: drawing.originX, top: 0, width: drawing.width, height: row }}
        onFocusProgramme={event => { const p = near.find(p => p.id === event.nativeEvent.id); if (p) props.onFocus(channel, p); }}
        onPressProgramme={event => { const p = near.find(p => p.id === event.nativeEvent.id); if (p) props.onPress(channel, p); }}
      /> : near.map((p, index) => (
        <ProgrammeCell
          key={Platform.isTV ? keys[index] : p.id}
          look={look}
          programme={p}
          channel={channel}
          scale={scale}
          row={row}
          small={props.small}
          nowMinute={props.nowMinute}
          visibleFrom={window.left}
          visibleWidth={props.visibleWidth}
          visibleHeight={props.visibleHeight}
          rowTop={props.rowTop}
          scrollY={props.scrollY}
          selected={p.id === props.selectedProgramme}
          scrollX={props.scrollX}
          onFocus={props.onFocus}
          onPress={props.onPress}
          onKey={props.onKey}
        />
      ))}
    </View>
  );
}, (a, b) => a.look === b.look && a.scale === b.scale && a.row === b.row && a.small === b.small && a.width === b.width
  && a.visibleHeight === b.visibleHeight && a.rowTop === b.rowTop && a.scrollY === b.scrollY && a.visibleWidth === b.visibleWidth && a.window.from === b.window.from && a.window.to === b.window.to
  && a.selectedMinute === b.selectedMinute && a.selectedChannel === b.selectedChannel && a.selectedProgramme === b.selectedProgramme && a.scrollX === b.scrollX
  && a.onFocus === b.onFocus && a.onPress === b.onPress && a.onKey === b.onKey && a.onWatch === b.onWatch
  && rowContentKey(a.channel) === rowContentKey(b.channel));

function NoListings({ look, channel, row, visibleWidth, scrollX, onWatch, onFocus, onKey, selectedChannel }: RowProps) {
  const follow = useAnimatedStyle(() => ({ transform: [{ translateX: scrollX.value }] }));
  return (
    <Animated.View
      style={[
        { position: 'absolute', left: 6, top: 6, height: row - 13, width: Math.max(120, visibleWidth - 12) },
        follow,
      ]}
    >
      <Press
        focusable={!Platform.isTV}
        nativeID={`guide-empty-${channel.id}`}
        onKey={(key, prevent) => onKey(channel, null, key, prevent)}
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
          borderColor: focused || Platform.isTV && selectedChannel ? look.accent : look.edge,
          backgroundColor: hovered ? look.cell : 'transparent',
          boxShadow: focused || Platform.isTV && selectedChannel ? `inset 0px 0px 0px 2px ${look.accent}` : undefined,
        })}
      >
        <Line look={look} size={13} color={look.inkQuiet}>
          {channel.listingsUnavailable ? msg('ui.theGuideCouldnTBeLoadedCheckYourConnection') : msg('live.noListings')}
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

/** A focused, known-empty interval stays at the same time when moving between channels. */
function GapCell({ look, channel, scale, row, gap, scrollX, onFocus, onKey, onWatch }: RowProps & { gap: { at: number; span: number } }) {
  const left = gap.at * scale;
  const width = Math.max(2, gap.span * scale - 4);
  const label = useAnimatedStyle(() => ({ transform: [{ translateX: Math.max(0, Math.min(scrollX.value - left, width - 160)) }] }));
  return <Press nativeID={gapId(channel.id, gap.at)} focusable={!Platform.isTV}
    label={`${msg('live.noListings')}. ${msg('ui.watchChannel', { channel: channel.name })}`}
    onFocus={() => onFocus(channel, null)} onKey={(key, prevent) => onKey(channel, null, key, prevent)} onPress={() => onWatch(channel.id)}
    style={({ focused }) => ({ position: 'absolute', left: left + 2, top: 5, width, height: row - 11, overflow: 'hidden',
      borderWidth: 1, borderStyle: 'dashed', borderColor: focused || Platform.isTV ? look.accent : look.edge, borderRadius: look.radiusCell, backgroundColor: look.cell })}>
    <Animated.View style={[{ flex: 1, justifyContent: 'center', paddingLeft: 16 }, label]}>
      <Line look={look} size={13} color={look.inkSecondary}>{msg('live.noListings')}</Line>
    </Animated.View>
  </Press>;
}
