// One programme block on the timeline. Its label stays readable beside the rail when the
// programme began before the panel's left edge; an airing block fills as it runs.
import { guideRender } from './diagnostics';
import { memo, useEffect, type ComponentProps } from 'react';
import { Platform, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, useReducedMotion, withSpring, ReduceMotion, type SharedValue } from 'react-native-reanimated';
import { msg, type GuideChannel, type GuideProgramme } from '@vela/core';
import { cellId, labelFollows, programmeFocusFrame } from './geometry';
import type { GuideLook } from './look';
import { Glyph, Line, Press } from './parts';

export interface CellProps {
  look: GuideLook;
  programme: GuideProgramme;
  channel: GuideChannel;
  scale: number;
  row: number;
  small: boolean;
  nowMinute: number;
  visibleFrom: number;
  visibleWidth: number;
  visibleHeight: number;
  rowTop: number;
  scrollY: SharedValue<number>;
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
  if (props.programmeFrame) return <LiftedProgramme {...props} />;
  return <View nativeID={props.nativeID} testID={props.testID} pointerEvents="none" accessible={false} focusable={false} style={props.style(passive)}>
    {typeof props.children === 'function' ? props.children(passive) : props.children}
  </View>;
}
/** Only selected and viewport-edge slots need animated geometry on TV. */
function LiftedProgramme(props: ComponentProps<typeof Press>) {
  const still = useReducedMotion();
  const scale = useSharedValue(1);
  useEffect(() => { scale.value = withSpring(still || !props.selected ? 1 : 1.045, { damping: 22, stiffness: 280, mass: 0.8, reduceMotion: ReduceMotion.System }); }, [scale, still, props.selected]);
  const frame = props.programmeFrame!;
  const lift = useAnimatedStyle(() => {
    const box = programmeFocusFrame(frame.left, frame.width, frame.scrollX.value, frame.viewportWidth, scale.value);
    const vertical = programmeFocusFrame(frame.top, frame.height, frame.scrollY.value - frame.rowTop, frame.viewportHeight, scale.value, 3);
    return { left: box.left, width: box.width, top: vertical.left, height: vertical.width,
      transform: [{ translateX: box.translateX }, { translateY: vertical.translateX }, { scaleX: box.scaleX }, { scaleY: vertical.scaleX }] };
  });
  return <Animated.View nativeID={props.nativeID} testID={props.testID} pointerEvents="none" accessible={false} focusable={false} style={[props.style(passive), lift]}>
    {typeof props.children === 'function' ? props.children(passive) : props.children}
  </Animated.View>;
}
const CellSurface = Platform.isTV ? PassiveProgramme : Press;

function nearViewportEdge(props: CellProps): boolean {
  const p = props.programme;
  return labelFollows(p.at, p.span, props.visibleFrom)
    || p.at + p.span > props.visibleFrom + props.visibleWidth / props.scale - 30;
}

function metaLine(p: GuideProgramme): string {
  const when = p.airing ? p.remainingLabel : msg('ui.startEnd', { start: p.startLabel, end: p.endLabel });
  return [when, p.episode].filter(Boolean).join(' · ');
}

export const ProgrammeCell = memo(function ProgrammeCell(props: CellProps) {
  guideRender('cell');
  const { look, programme: p, channel, scale, row, small, nowMinute, selected, scrollX } = props;
  const left = p.at * scale;
  const width = p.span * scale;
  const top = Math.min(5, Math.floor((row - 40) / 2));
  const height = row - 2 * top - 1;
  const elapsed = p.airing ? Math.max(0, Math.min(width, (nowMinute - p.at) * scale)) : 0;
  const labelled = width >= 10 * scale;
  // A past programme the archive still holds looks playable: it keeps its colour and gains a replay mark.
  const replay = p.replay === 'catchUp';
  const label = msg('ui.programmeStartToEndChannelProgrammeDetails', {
    programme: p.name,
    start: p.startLabel,
    end: p.endLabel,
    channel: channel.name,
  }) + (replay ? `, ${msg('catchUp.replayable')}` : '');
  return (
    <CellSurface
      lift
      programmeFrame={!Platform.isTV || selected || nearViewportEdge(props) ? { left: left + 2, width: Math.max(2, width - 4), viewportWidth: props.visibleWidth, scrollX, top, height, rowTop: props.rowTop, viewportHeight: props.visibleHeight, scrollY: props.scrollY } : undefined}
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
        top,
        width: Math.max(2, width - 4),
        height,
        flexDirection: 'row',
        alignItems: 'stretch',
        overflow: 'hidden',
        borderRadius: look.radiusCell,
        borderWidth: focused || Platform.isTV && selected ? 2 : 0,
        borderColor: focused || Platform.isTV && selected ? look.accent : hovered ? look.edgeStrong : p.airing ? look.liveEdge : look.hairline,
        backgroundColor: focused || Platform.isTV && selected ? look.cellHover : p.airing ? look.live : hovered ? look.cellHover : look.cell,
        opacity: p.ended && !replay && !(focused || Platform.isTV && selected) ? 0.72 : 1,
        zIndex: focused || Platform.isTV && selected ? 3 : 0,
        boxShadow: Platform.isTV ? selected ? `0px 0px 2px ${look.shadow}` : undefined : focused
          ? `inset 0px 0px 0px 1px ${look.accent}, 0px 0px 2px ${look.shadow}`
          : selected
            ? `inset 0px 0px 0px 2px ${look.accent}`
            : undefined,
      })}
    >
      {elapsed > 0 ? (
        <ProgrammeFill elapsed={elapsed} left={left + 2} scrollX={scrollX} color={look.liveFill} />
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
            opacity: p.ended && !replay ? 0.5 : 0.9,
          }}
        />
      ) : null}
      {elapsed > 0 ? (
        <ProgrammeFill elapsed={elapsed} left={left + 2} scrollX={scrollX} color={look.accent} line />
      ) : null}
      {labelled ? <View style={{ flex: 1, justifyContent: 'center', gap: small ? 3 : 4, paddingLeft: 12, paddingRight: 10, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 }}>
          {replay ? <View testID={`replay-${p.id}`}><Glyph name="replay" size={small ? 11 : 12} color={look.accent} /></View> : null}
          <View style={{ flexShrink: 1, minWidth: 0 }}><Line look={look} size={small ? 13 : 14} weight={p.airing ? 680 : 600}>{p.name}</Line></View>
        </View>
        {width > 110 ? <Line look={look} size={12} color={p.airing ? look.accent : look.inkSecondary} tabular>{metaLine(p)}</Line> : null}
      </View> : null}
    </CellSurface>
  );
}, (a, b) => a.look === b.look && a.channel.id === b.channel.id && a.channel.name === b.channel.name
  && a.visibleHeight === b.visibleHeight && a.rowTop === b.rowTop && a.scrollY === b.scrollY && a.visibleWidth === b.visibleWidth && a.scale === b.scale && a.row === b.row && a.small === b.small && a.selected === b.selected && a.scrollX === b.scrollX
  && a.onFocus === b.onFocus && a.onPress === b.onPress && a.onKey === b.onKey
  && a.programme.id === b.programme.id && a.programme.name === b.programme.name
  && a.programme.at === b.programme.at && a.programme.span === b.programme.span
  && (!Platform.isTV || nearViewportEdge(a) === nearViewportEdge(b))
  && a.programme.episode === b.programme.episode && a.programme.tone === b.programme.tone
  && a.programme.replay === b.programme.replay && a.programme.ended === b.programme.ended);

function ProgrammeFill({ elapsed, left, scrollX, color, line = false }: {
  elapsed: number; left: number; scrollX: SharedValue<number>; color: string; line?: boolean;
}) {
  const fill = useAnimatedStyle(() => ({ width: Math.max(0, elapsed - Math.max(0, scrollX.value + 6 - left)) }));
  return <Animated.View style={[{ position: 'absolute', left: 0, bottom: 0, ...(line ? { height: 2 } : { top: 0 }), backgroundColor: color }, fill]} />;
}
