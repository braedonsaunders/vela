// A control's menu: a compact glass panel over the control bar with the menu's name above a
// radio list. On TV focus starts on the active choice and stays inside until the menu closes.
import { BlurView } from 'expo-blur';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from 'react-native';
import { PlayerIcon } from './icons';
import type { PlayerLook } from './look';
import { Spinner } from './spinner';

/** Keeps focus inside on TV; a plain view elsewhere (react-native-web has no focus guide). */
function FocusTrap({ children }: { children: ReactNode }) {
  if (!Platform.isTV) return <View>{children}</View>;
  return <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>{children}</TVFocusGuideView>;
}

/** Drawn inside the control row's box: it opens upward from the row, at its right edge. */
export function MenuPanel({ look, name, maxHeight, children }: { look: PlayerLook; name: string; maxHeight: number; children: ReactNode }) {
  return (
    <View accessibilityRole="menu" accessibilityLabel={name} testID="player-menu"
      style={{ position: 'absolute', right: 0, left: look.small ? 0 : undefined, bottom: '100%', marginBottom: look.size(12),
        width: look.small ? undefined : look.size(320), maxHeight, borderRadius: Math.min(look.radiusPanel, look.size(18)),
        borderWidth: 1, borderColor: look.glassEdge, overflow: 'hidden', boxShadow: `0px 30px 90px ${look.shadow}` }}>
      <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.popover }]} />
      <Text style={[look.text(11, 650, look.inkQuiet), { letterSpacing: look.size(1.1), textTransform: 'uppercase',
        paddingHorizontal: look.size(20), paddingTop: look.size(14), paddingBottom: look.size(8) }]}>
        {name}
      </Text>
      <ScrollView contentContainerStyle={{ paddingHorizontal: look.size(8), paddingBottom: look.size(8) }}>
        <FocusTrap>{children}</FocusTrap>
      </ScrollView>
    </View>
  );
}

interface Choice {
  look: PlayerLook;
  name: string;
  detail?: string;
  selected: boolean;
  /** The engine is switching to it. */
  pending?: boolean;
  enabled: boolean;
  onChoose(): void;
  testID?: string;
}

/** One choice: a check on the active item (a spinner while the engine switches), its name and one muted detail. */
export function ChoiceRow({ look, name, detail, selected, pending, enabled, onChoose, testID }: Choice) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const lit = look.tv && focus;
  const ink = lit ? look.inkInverse : look.ink;
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: !enabled }}
      accessibilityLabel={detail ? `${name}, ${detail}` : name} disabled={!enabled} hasTVPreferredFocus={selected}
      testID={testID} onPress={onChoose}
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: look.size(12), minHeight: look.size(44),
        paddingHorizontal: look.size(12), paddingVertical: look.size(8), borderRadius: look.size(12),
        backgroundColor: lit ? look.ink : hover ? look.controlHover : selected ? look.control : 'transparent',
        opacity: enabled || selected ? 1 : 0.4, outlineColor: look.accent, outlineStyle: 'solid',
        outlineWidth: focus && !look.tv ? 2 : 0 }}>
      <View style={{ width: look.size(16), height: look.size(16), alignItems: 'center', justifyContent: 'center' }}>
        {pending ? <Spinner look={look} size={look.size(14)} />
          : selected ? <PlayerIcon name="check" size={look.size(14)} color={lit ? look.inkInverse : look.accent} /> : null}
      </View>
      <Text numberOfLines={1} style={[look.text(14, selected ? 650 : 500, ink), { flex: 1, minWidth: 0 }]}>{name}</Text>
      {detail ? (
        <Text numberOfLines={1} style={[look.text(12, 400, lit ? look.inkInverse : look.inkQuiet),
          { flexShrink: 0, maxWidth: '55%', fontVariant: ['tabular-nums'] }]}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A heading inside a menu: a resolution above its bitrates, a subtitle setting above its segments. */
export function MenuHeading({ look, text }: { look: PlayerLook; text: string }) {
  return (
    <Text style={[look.text(11, 650, look.inkQuiet), { letterSpacing: look.size(0.9), paddingHorizontal: look.size(12),
      paddingTop: look.size(10), paddingBottom: look.size(2) }]}>
      {text}
    </Text>
  );
}

export function MenuRule({ look }: { look: PlayerLook }) {
  return <View style={{ height: 1, marginVertical: look.size(6), marginHorizontal: look.size(12), backgroundColor: look.glassEdge }} />;
}

interface Segments {
  look: PlayerLook;
  name: string;
  options: { value: string; label: string }[];
  current: string;
  enabled: boolean;
  onPick(value: string): void;
}

/** One setting as a row of segments, the current one filled. */
export function SegmentRow({ look, name, options, current, enabled, onPick }: Segments) {
  return (
    <View style={{ gap: look.size(6), paddingHorizontal: look.size(12), paddingVertical: look.size(6) }}>
      <Text style={look.text(12, 400, look.inkQuiet)}>{name}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={name}
        style={{ flexDirection: 'row', gap: 2, padding: 3, borderRadius: look.size(11), backgroundColor: look.control }}>
        {options.map(option => (
          <Segment key={option.value} look={look} label={option.label} on={option.value === current} enabled={enabled}
            onPress={() => onPick(option.value)} />
        ))}
      </View>
    </View>
  );
}

function Segment({ look, label, on, enabled, onPress }: { look: PlayerLook; label: string; on: boolean; enabled: boolean; onPress(): void }) {
  const [focus, setFocus] = useState(false);
  const filled = on || (look.tv && focus);
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !enabled }} accessibilityLabel={label}
      disabled={!enabled} onPress={onPress} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={{ flex: 1, minWidth: 0, height: look.size(30), alignItems: 'center', justifyContent: 'center',
        borderRadius: look.size(8), backgroundColor: filled ? look.ink : 'transparent', outlineColor: look.accent,
        outlineStyle: 'solid', outlineWidth: focus && !look.tv ? 2 : 0 }}>
      <Text numberOfLines={1} style={look.text(12, 600, filled ? look.inkInverse : look.ink)}>{label}</Text>
    </Pressable>
  );
}
