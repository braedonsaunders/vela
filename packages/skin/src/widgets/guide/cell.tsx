// One programme block on the timeline. Its label stays readable beside the rail when the
// programme began before the panel's left edge; an airing block fills as it runs.
import { guideRender } from './diagnostics';
import { memo, type ComponentProps } from 'react';
import { Platform, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { msg, type GuideChannel, type GuideProgramme } from '@vela/core';
import { cellId, labelFollows } from './geometry';
import type { GuideLook } from './look';
import { Line, Press } from './parts';

export interface CellProps {
  look: GuideLook;
  programme: GuideProgramme;
  channel: GuideChannel;
  scale: number;
  row: number;
  small: boolean;
  nowMinute: number;
  visibleFrom: number;
  selected: boolean;
  /** The timeline's horizontal scroll, for the label that keeps clear of the panel's edge. */
  scrollX: SharedValue<number>;
  onFocus(channel: GuideChannel, programme: GuideProgramme): void;
  onPress(channel: GuideChannel, programme: GuideProgramme): void;
  onKey(channel: GuideChannel, programme: GuideProgramme, key: string, prevent: () => void): void;
}

const passive = { hovered: false, focused: false, pressed: false };
/** TV focus is owned by the grid anchor. Passive cells avoid a focus registry and state per slot. */
function PassiveProgramme(props: ComponentProps<typeof Press>) {
  return <View nativeID={props.nativeID} testID={props.testID} pointerEvents="none" accessible={false} focusable={false} style={props.style(passive)}>
    {typeof props.children === 'function' ? props.children(passive) : props.children}
  </View>;
}
const CellSurface = Platform.isTV ? PassiveProgramme : Press;

function metaLine(p: GuideProgramme): string {
  const when = p.airing ? p.remainingLabel : msg('ui.startEnd', { start: p.startLabel, end: p.endLabel });
  return [when, p.episode].filter(Boolean).join(' · ');
}

export const ProgrammeCell = memo(function ProgrammeCell(props: CellProps) {
  guideRender('cell');
  const { look, programme: p, channel, scale, row, small, nowMinute, selected, scrollX } = props;
  const left = p.at * scale;
  const width = p.span * scale;
  const elapsed = p.airing ? Math.max(0, Math.min(width, (nowMinute - p.at) * scale)) : 0;
  const labelled = width >= 10 * scale;
  const label = msg('ui.programmeStartToEndChannelProgrammeDetails', {
    programme: p.name,
    start: p.startLabel,
    end: p.endLabel,
    channel: channel.name,
  });
  return (
    <CellSurface
      focusable={!Platform.isTV}
      nativeID={cellId(p.id, channel.id)}
      testID={cellId(p.id, channel.id)}
      label={label}
      selected={selected}
      onPress={() => props.onPress(channel, p)}
      onFocus={() => props.onFocus(channel, p)}
      onKey={(key, prevent) => props.onKey(channel, p, key, prevent)}
      style={({ hovered, focused }) => ({
        position: 'absolute',
        left: left + 2,
        top: 5,
        width: Math.max(2, width - 4),
        height: row - 11,
        flexDirection: 'row',
        alignItems: 'stretch',
        overflow: 'hidden',
        borderRadius: look.radiusCell,
        borderWidth: Platform.isTV && selected ? 2 : 1,
        borderColor: focused || Platform.isTV && selected ? look.accent : hovered ? look.edgeStrong : p.airing ? look.liveEdge : look.hairline,
        backgroundColor: p.airing ? look.live : hovered ? look.cellHover : look.cell,
        opacity: p.ended ? 0.46 : 1,
        boxShadow: Platform.isTV ? undefined : focused
          ? `inset 0px 0px 0px 1px ${look.accent}, 0px 10px 34px ${look.shadow}`
          : selected
            ? `inset 0px 0px 0px 2px ${look.accent}`
            : undefined,
      })}
    >
      {elapsed > 0 ? (
        <View
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: elapsed, backgroundColor: look.liveFill }}
        />
      ) : null}
      {p.tone >= 0 && width > 24 ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 10,
            bottom: 10,
            width: 3,
            borderRadius: 2,
            backgroundColor: look.tone(p.tone),
            opacity: p.ended ? 0.5 : 0.9,
          }}
        />
      ) : null}
      {elapsed > 0 ? (
        <View
          style={{ position: 'absolute', left: 0, bottom: 0, height: 2, width: elapsed, backgroundColor: look.accent }}
        />
      ) : null}
      {labelled ? <CellLabel {...props} left={left} width={width} /> : null}
    </CellSurface>
  );
}, (a, b) => a.look === b.look && a.channel.id === b.channel.id && a.channel.name === b.channel.name
  && a.scale === b.scale && a.row === b.row && a.small === b.small && a.selected === b.selected && a.scrollX === b.scrollX
  && a.onFocus === b.onFocus && a.onPress === b.onPress && a.onKey === b.onKey
  && a.programme.id === b.programme.id && a.programme.name === b.programme.name
  && a.programme.at === b.programme.at && a.programme.span === b.programme.span
  && (!Platform.isTV || labelFollows(a.programme.at, a.programme.span, a.visibleFrom) === labelFollows(b.programme.at, b.programme.span, b.visibleFrom))
  && a.programme.episode === b.programme.episode && a.programme.tone === b.programme.tone);

/** Future cells have static labels; only edge cells need an animation worklet on TV. */
function CellLabel(props: CellProps & { left: number; width: number }) {
  if (!Platform.isTV || labelFollows(props.programme.at, props.programme.span, props.visibleFrom)) return <SlidingCellLabel {...props} />;
  return <View style={{ justifyContent: 'center', gap: props.small ? 3 : 4, paddingLeft: 12, paddingRight: 10, minWidth: 0, maxWidth: props.width - 4 }}>
    <Line look={props.look} size={props.small ? 13 : 14} weight={props.programme.airing ? 680 : 600}>{props.programme.name}</Line>
    {props.width > 110 ? <Line look={props.look} size={12} color={props.programme.airing ? props.look.accent : props.look.inkSecondary} tabular>{metaLine(props.programme)}</Line> : null}
  </View>;
}

/** The cell's title and times, slid right while the cell's start is scrolled past. */
function SlidingCellLabel({ look, programme: p, small, scrollX, left, width }: CellProps & { left: number; width: number }) {
  const slide = useAnimatedStyle(() => {
    const past = Math.max(0, scrollX.value - left);
    const shift = Math.min(past, Math.max(0, width - 120));
    return { transform: [{ translateX: shift }], maxWidth: Math.max(0, width - 4 - shift) };
  });
  return (
    <Animated.View
      style={[{ justifyContent: 'center', gap: small ? 3 : 4, paddingLeft: 12, paddingRight: 10, minWidth: 0 }, slide]}
    >
      <Line look={look} size={small ? 13 : 14} weight={p.airing ? 680 : 600}>
        {p.name}
      </Line>
      {width > 110 ? (
        <Line look={look} size={12} color={p.airing ? look.accent : look.inkSecondary} tabular>
          {metaLine(p)}
        </Line>
      ) : null}
    </Animated.View>
  );
}
