// The guide's controls: chips, pills and the pieces of its toolbar (days, the time stepper,
// "Now", zoom, full guide, favourites, the channel filter and the owner's named Guides).
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
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

const ring = (look: GuideLook, focused: boolean) =>
  focused ? `0px 0px 0px 2px ${look.page}, 0px 0px 0px 4px ${look.accent}` : undefined;

/** A pill chip: a day, "Now", a filter. */
export function Chip({
  look,
  label,
  on,
  onPress,
  children,
  height = 36,
}: {
  look: GuideLook;
  label: string;
  on?: boolean;
  onPress(): void;
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <Press
      label={label}
      selected={on}
      onPress={onPress}
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
}: {
  look: GuideLook;
  label: string;
  glyph: string;
  onPress(): void;
  on?: boolean;
  color?: string;
}) {
  return (
    <Press
      label={label}
      selected={on}
      role={on === undefined ? 'button' : 'togglebutton'}
      onPress={onPress}
      style={({ hovered, focused, pressed }) => ({
        width: 38,
        height: 38,
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
      <Glyph name={glyph} size={16} color={color ?? look.ink} />
    </Press>
  );
}

export function DayChips({
  look,
  model,
  onPick,
  side,
}: {
  look: GuideLook;
  model: GuideModel;
  onPick(day: number): void;
  side: number;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, flexShrink: 1 }}
      contentContainerStyle={{ gap: 6, alignItems: 'center', paddingHorizontal: side }}
      accessibilityLabel={msg('live.day')}
    >
      {model.days.map(d => {
        const on = d.offset === model.day;
        return (
          <Chip key={d.offset} look={look} label={`${d.label} ${d.date}`} on={on} onPress={() => onPick(d.offset)}>
            <Line look={look} size={13} weight={650} color={on ? look.inkInverse : look.ink}>
              {d.label}
            </Line>
            {d.offset > 1 ? (
              <Line look={look} size={12} color={on ? look.inkInverse : look.ink} style={{ opacity: 0.62 }}>
                {d.date}
              </Line>
            ) : null}
          </Chip>
        );
      })}
    </ScrollView>
  );
}

/** "Now", with a pulsing dot unless motion is reduced. */
export function NowChip({ look, still, onPress }: { look: GuideLook; still: boolean; onPress(): void }) {
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
    <Chip look={look} label={msg('live.jumpToNow')} onPress={onPress} height={38}>
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
}: {
  look: GuideLook;
  options: { value: T; label: string; name: string }[];
  value: T;
  onPick(value: T): void;
  label: string;
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
            key={String(o.value)}
            label={o.name}
            selected={on}
            role="tab"
            onPress={() => onPick(o.value)}
            style={({ focused }) => ({
              height: 30,
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
  const options: ChannelFilter[] = ['all', 'favourites', 'listed', ...groups.map(g => `group:${g}` as const)];
  return (
    <View style={{ position: 'relative', zIndex: 20 }}>
      <Chip
        look={look}
        label={`${msg('live.filter')}: ${filterLabel(filter)}`}
        onPress={() => setOpen(o => !o)}
        height={38}
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
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, flexShrink: 0, marginBottom: small ? 8 : 10 }}
      contentContainerStyle={{
        gap: small ? 18 : 24,
        height: 38,
        paddingLeft: small ? side : side + 6,
        paddingRight: side,
      }}
      accessibilityLabel={msg('live.guides')}
    >
      {tabs.map(t => {
        const on = t.id === tab;
        return (
          <Press
            key={t.id || 'all'}
            label={t.name}
            role="tab"
            selected={on}
            onPress={() => onPick(t.id)}
            style={({ focused }) => ({
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
