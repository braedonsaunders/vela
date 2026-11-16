// One programme block on the timeline. Its label stays readable beside the rail when the
// programme began before the panel's left edge; an airing block fills as it runs.
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { msg } from '../../../../../client/foundation/i18n';
import type { GuideChannel, GuideProgramme } from '../../../../../client/src/live/guide';
import { cellId } from './geometry';
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
  selected: boolean;
  /** The timeline's horizontal scroll, for the label that keeps clear of the panel's edge. */
  scrollX: SharedValue<number>;
  onFocus(channel: GuideChannel, programme: GuideProgramme): void;
  onPress(channel: GuideChannel, programme: GuideProgramme): void;
  onKey(channel: GuideChannel, programme: GuideProgramme, key: string, prevent: () => void): void;
}

function metaLine(p: GuideProgramme): string {
  const when = p.airing ? p.remainingLabel : msg('ui.startEnd', { start: p.startLabel, end: p.endLabel });
  return [when, p.episode].filter(Boolean).join(' · ');
}

export function ProgrammeCell(props: CellProps) {
  const { look, programme: p, channel, scale, row, small, nowMinute, selected, scrollX } = props;
  const left = p.at * scale;
  const width = p.span * scale;
  const elapsed = p.airing ? Math.max(0, Math.min(width, (nowMinute - p.at) * scale)) : 0;
  const labelled = width >= 10 * scale;
  const label = msg('ui.programmeStartToEndChannelProgrammeDetails', {
    programme: p.name, start: p.startLabel, end: p.endLabel, channel: channel.name,
  });
  return (
    <Press
      nativeID={cellId(p.id)}
      testID={cellId(p.id)}
      label={label}
      selected={selected}
      onPress={() => props.onPress(channel, p)}
      onFocus={() => props.onFocus(channel, p)}
      onKey={(key, prevent) => props.onKey(channel, p, key, prevent)}
      style={({ hovered, focused }) => ({
        position: 'absolute', left: left + 2, top: 5, width: Math.max(2, width - 4), height: row - 11,
        flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden', borderRadius: look.radiusCell, borderWidth: 1,
        borderColor: focused ? look.accent : hovered ? look.edgeStrong : p.airing ? look.liveEdge : look.hairline,
        backgroundColor: p.airing ? look.live : hovered ? look.cellHover : look.cell,
        opacity: p.ended ? 0.46 : 1,
        boxShadow: focused
          ? `inset 0px 0px 0px 1px ${look.accent}, 0px 10px 34px ${look.shadow}`
          : selected ? `inset 0px 0px 0px 2px ${look.accent}` : undefined,
      })}
    >
      {elapsed > 0 ? <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: elapsed, backgroundColor: look.liveFill }} /> : null}
      {p.tone >= 0 && width > 24 ? (
        <View style={{
          position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: 2,
          backgroundColor: look.tone(p.tone), opacity: p.ended ? 0.5 : 0.9,
        }} />
      ) : null}
      {elapsed > 0 ? <View style={{ position: 'absolute', left: 0, bottom: 0, height: 2, width: elapsed, backgroundColor: look.accent }} /> : null}
      {labelled ? <CellLabel {...props} left={left} width={width} /> : null}
    </Press>
  );
}

/** The cell's title and times, slid right while the cell's start is scrolled past. */
function CellLabel({ look, programme: p, small, scrollX, left, width }: CellProps & { left: number; width: number }) {
  const slide = useAnimatedStyle(() => {
    const past = Math.max(0, scrollX.value - left);
    const shift = Math.min(past, Math.max(0, width - 120));
    return { transform: [{ translateX: shift }], maxWidth: Math.max(0, width - 4 - shift) };
  });
  return (
    <Animated.View style={[{ justifyContent: 'center', gap: small ? 3 : 4, paddingLeft: 12, paddingRight: 10, minWidth: 0 }, slide]}>
      <Line look={look} size={small ? 13 : 14} weight={p.airing ? 680 : 600}>{p.name}</Line>
      {width > 110 ? (
        <Line look={look} size={12} color={p.airing ? look.accent : look.inkSecondary} tabular>{metaLine(p)}</Line>
      ) : null}
    </Animated.View>
  );
}
