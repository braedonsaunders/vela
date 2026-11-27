// The guide's controls: chips, pills and the pieces of its toolbar (days, the time stepper,
// "Now", zoom, full guide, favourites, the channel filter and the owner's named Guides).
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { msg, type GuideModel } from '@vela/core';
import type { ChannelFilter } from './geometry';
import type { GuideLook } from './look';
import { Glyph, Line, Press, type Interaction } from './parts';
import { holdBack } from '../../menu-key';
import { GuideRegion } from './focus';

/** The compact scale on a phone (vela-base/look.ts `phone`): 36pt controls whose touch reaches 44pt. */
export const COMPACT = { size: 36, slop: { top: 4, bottom: 4, left: 4, right: 4 } } as const;

const ring = (look: GuideLook, focused: boolean) =>
  focused ? `0px 0px 0px 2px ${look.page}, 0px 0px 0px 4px ${look.accent}` : undefined;

/** A pill chip: a day, "Now", a filter. */
export function Chip({
  look,
  label,
  on,
  onPress,
  children,
  height = 44,
  nativeID,
  compact = false,
}: {
  look: GuideLook;
  label: string;
  on?: boolean;
  onPress(): void;
  children: React.ReactNode;
  height?: number;
  nativeID?: string;
  /** A phone's chip: drawn 36pt tall, reaching the 44pt touch target (COMPACT). */
  compact?: boolean;
}) {
  if (compact) height = COMPACT.size;
  return (
    <Press
      lift
      nativeID={nativeID}
      label={label}
      selected={on}
      onPress={onPress}
      hitSlop={compact ? COMPACT.slop : undefined}
      style={({ hovered, focused, pressed }: Interaction) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        height,
        paddingHorizontal: 14,
        flexShrink: 0,
        borderRadius: look.radiusControl,
        borderWidth: 1,
        borderColor: on ? look.ink : hovered ? look.edgeStrong : look.edge,
        backgroundColor: on ? look.ink : look.control,
        transform: [{ scale: pressed ? 0.97 : 1 }],
        boxShadow: ring(look, focused),
      })}
    >
      {children}
    </Press>
  );
}

export function IconButton({
  look,
  label,
  glyph,
  onPress,
  on,
  color,
  compact = false,
}: {
  look: GuideLook;
  label: string;
  glyph: string;
  onPress(): void;
  on?: boolean;
  color?: string;
  compact?: boolean;
}) {
  const size = compact ? COMPACT.size : 44;
  return (
    <Press
      lift
      label={label}
      toggled={on}
      role="button"
      onPress={onPress}
      hitSlop={compact ? COMPACT.slop : undefined}
      style={({ hovered, focused, pressed }) => ({
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        borderRadius: look.radiusControl,
        borderWidth: 1,
        borderColor: look.edge,
        backgroundColor: hovered ? look.controlHover : look.control,
        transform: [{ scale: pressed ? 0.94 : 1 }],
        boxShadow: focused ? `0px 0px 0px 2px ${look.accent}` : undefined,
      })}
    >
      <Glyph name={glyph} size={compact ? 15 : 16} color={color ?? look.ink} />
    </Press>
  );
}

export function DayChips({
  look,
  model,
  onPick,
  side,
  compact = false,
  fadeEdges = false,
}: {
  look: GuideLook;
  model: GuideModel;
  onPick(day: number): void;
  side: number;
  compact?: boolean;
  fadeEdges?: boolean;
}) {
  const metrics = useRef({ offset: 0, width: 0, content: 0 });
  const [edges, setEdges] = useState({ left: false, right: false });
  const updateEdges = (change: Partial<typeof metrics.current>) => {
    const { offset, width, content } = Object.assign(metrics.current, change);
    const left = offset > 1;
    const right = content - width - offset > 1;
    setEdges(old => old.left === left && old.right === right ? old : { left, right });
  };
  const chips = (
    <ScrollView
      horizontal
      scrollsToTop={false}
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, flexShrink: 1 }}
      // A compact chip's touch reaches past its edge: the strip holds that reach, so it is not clipped.
      contentContainerStyle={{ gap: 6, alignItems: 'center', paddingHorizontal: side, paddingVertical: compact ? COMPACT.slop.top : 0 }}
      onLayout={fadeEdges ? e => updateEdges({ width: e.nativeEvent.layout.width }) : undefined}
      onContentSizeChange={fadeEdges ? content => updateEdges({ content }) : undefined}
      onScroll={fadeEdges ? e => updateEdges({ offset: e.nativeEvent.contentOffset.x }) : undefined}
      scrollEventThrottle={fadeEdges ? 16 : undefined}
      accessibilityLabel={msg('live.day')}
    >
      {model.days.map(d => {
        const on = d.offset === model.day;
        return (
          <Chip key={d.offset} look={look} label={`${d.label} ${d.date}`} on={on} onPress={() => onPick(d.offset)} compact={compact}>
            <Line look={look} size={13} weight={650} color={on ? look.inkInverse : look.ink}>
              {d.label}
            </Line>
            {d.offset < 0 || d.offset > 1 ? (
              <Line look={look} size={12} color={on ? look.inkInverse : look.ink} style={{ opacity: 0.62 }}>
                {d.date}
              </Line>
            ) : null}
          </Chip>
        );
      })}
    </ScrollView>
  );
  if (!fadeEdges) return chips;
  return (
    <View style={{ flexShrink: 1, minWidth: 0 }}>
      {chips}
      {(['left', 'right'] as const).map(edge => edges[edge] ? (
        <LinearGradient key={edge} pointerEvents="none"
          colors={['transparent', look.page]}
          start={{ x: edge === 'left' ? 1 : 0, y: 0.5 }}
          end={{ x: edge === 'left' ? 0 : 1, y: 0.5 }}
          style={{ position: 'absolute', [edge]: 0, top: 0, bottom: 0, width: 36 }} />
      ) : null)}
    </View>
  );
}

/** "Now", with a pulsing dot unless motion is reduced. */
export function NowChip({ look, still, onPress, compact = false }: { look: GuideLook; still: boolean; onPress(): void; compact?: boolean }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    pulse.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(pulse);
  }, [still, pulse]);
  const ripple = useAnimatedStyle(() => ({
    opacity: pulse.value < 0.7 ? 1 - pulse.value / 0.7 : 0,
    transform: [{ scale: 1 + Math.min(1, pulse.value / 0.7) * 1.6 }],
  }));
  return (
    <Chip nativeID="guide-toolbar-now" look={look} label={msg('live.jumpToNow')} onPress={onPress} height={44} compact={compact}>
      <View style={{ width: 8, height: 8 }}>
        {!still ? (
          <Animated.View
            style={[{ position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: look.now }, ripple]}
          />
        ) : null}
        <View style={{ position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: look.now }} />
      </View>
      <Line look={look} size={13} weight={650}>
        {msg('live.now')}
      </Line>
    </Chip>
  );
}

/** A segmented group: zoom levels, or the phone's On now / Guide switch. */
export function Segments<T extends string | number>({
  look,
  options,
  value,
  onPick,
  label,
  compact = false,
}: {
  look: GuideLook;
  options: { value: T; label: string; name: string }[];
  value: T;
  onPick(value: T): void;
  label: string;
  /** A phone's switch: 44pt overall, each segment 36pt reaching the switch's full height. */
  compact?: boolean;
}) {
  return (
    <View
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        gap: 2,
        padding: 3,
        borderRadius: look.radiusControl,
        backgroundColor: look.control,
        borderWidth: 1,
        borderColor: look.edge,
        flexShrink: 0,
      }}
    >
      {options.map(o => {
        const on = o.value === value;
        return (
          <Press
      lift
            key={String(o.value)}
            label={o.name}
            selected={on}
            role="tab"
            onPress={() => onPick(o.value)}
            hitSlop={compact ? { top: 4, bottom: 4 } : undefined}
            style={({ focused }) => ({
              height: compact ? COMPACT.size : 44,
              paddingHorizontal: 12,
              justifyContent: 'center',
              borderRadius: look.radiusControl,
              backgroundColor: on ? look.ink : 'transparent',
              boxShadow: focused ? `0px 0px 0px 2px ${look.accent}` : undefined,
            })}
          >
            <Line look={look} size={12} weight={650} color={on ? look.inkInverse : look.inkSecondary} tabular>
              {o.label}
            </Line>
          </Press>
        );
      })}
    </View>
  );
}

function filterLabel(filter: ChannelFilter): string {
  if (filter === 'favourites') return msg('live.favourites');
  if (filter === 'listed') return msg('live.withListings');
  if (filter.startsWith('group:')) return filter.slice(6);
  return msg('live.allChannels');
}

/** The channel filter: every channel, favourites, those with listings, or one group. */
export function FilterMenu({
  look,
  filter,
  groups,
  onPick,
}: {
  look: GuideLook;
  filter: ChannelFilter;
  groups: string[];
  onPick(f: ChannelFilter): void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<ComponentRef<typeof View>>(null);
  const options: ChannelFilter[] = ['all', 'favourites', 'listed', ...groups.map(g => `group:${g}` as const)];
  // An open menu closes on Escape (Back natively), returning focus to its chip, and on the web on
  // a press anywhere outside it.
  useEffect(() => {
    if (!open) return;
    const release = holdBack(() => {
      setOpen(false);
      return true;
    });
    if (Platform.OS !== 'web' || typeof document === 'undefined') return release;
    const node = box.current as unknown as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
      node?.querySelector<HTMLElement>('[role="button"]')?.focus();
    };
    const onDown = (event: PointerEvent) => {
      if (node && !node.contains(event.target as globalThis.Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      release();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);
  return (
    <GuideRegion.Provider value={open ? 'header' : 'toolbar'}>
    <View ref={box} style={{ position: 'relative', zIndex: 20 }}>
      <Chip
        look={look}
        label={`${msg('live.filter')}: ${filterLabel(filter)}`}
        onPress={() => setOpen(o => !o)}
        height={44}
      >
        <Line look={look} size={13} weight={600}>
          {filterLabel(filter)}
        </Line>
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <Glyph name="forward-chevron" size={12} color={look.inkSecondary} />
        </View>
      </Chip>
      {open ? (
        <View
          style={{
            position: 'absolute',
            top: 44,
            right: 0,
            minWidth: 200,
            maxHeight: 320,
            paddingVertical: 6,
            borderRadius: 14,
            backgroundColor: look.ui.popover,
            borderWidth: 1,
            borderColor: look.edge,
            boxShadow: `0px 24px 60px ${look.shadow}`,
          }}
        >
          <ScrollView>
            {options.map(option => (
              <Press
      lift
                key={option}
                label={filterLabel(option)}
                selected={option === filter}
                onPress={() => {
                  onPick(option);
                  setOpen(false);
                }}
                style={({ hovered, focused }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 9,
                  paddingHorizontal: 14,
                  backgroundColor: hovered || focused ? look.controlHover : 'transparent',
                })}
              >
                <View style={{ width: 14 }}>
                  {option === filter ? <Glyph name="checkmark" size={14} color={look.accent} /> : null}
                </View>
                <Line look={look} size={14}>
                  {filterLabel(option)}
                </Line>
              </Press>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
    </GuideRegion.Provider>
  );
}

/** The owner's named Guides as tabs over the lineup; a channel may sit in several. */
export function GuideTabs({
  look,
  model,
  tab,
  onPick,
  side,
  small,
}: {
  look: GuideLook;
  model: GuideModel;
  tab: string;
  onPick(id: string): void;
  side: number;
  small: boolean;
}) {
  const tabs = [{ id: '', name: msg('live.allChannels') }, ...model.guides];
  return (
    <ScrollView
      horizontal
      scrollsToTop={false}
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, flexShrink: 0, marginBottom: small ? 8 : 10 }}
      contentContainerStyle={{
        gap: small ? 18 : 24,
        height: 44,
        paddingLeft: small ? side : side + 6,
        paddingRight: side,
      }}
      accessibilityLabel={msg('live.guides')}
    >
      {tabs.map(t => {
        const on = t.id === tab;
        return (
          <Press
      lift
            key={t.id || 'all'}
            label={t.name}
            role="tab"
            selected={on}
            onPress={() => onPick(t.id)}
            style={({ focused }) => ({
              minWidth: 44,
              justifyContent: 'center',
              paddingHorizontal: 2,
              borderBottomWidth: 2,
              borderBottomColor: on || focused ? look.accent : 'transparent',
            })}
          >
            {({ hovered }) => (
              <Line look={look} size={14} weight={on ? 650 : 550} color={on || hovered ? look.ink : look.inkQuiet}>
                {t.name}
              </Line>
            )}
          </Press>
        );
      })}
    </ScrollView>
  );
}
