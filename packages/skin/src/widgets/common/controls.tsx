// The foundation surfaces' controls, in the Vela base's look (client/src/skin/vela-base): pills,
// fields, the waiting pulse, a code drawn one tile per character, headings and alerts. Each
// tracks its own hover, focus and pressed states, so the same look works by pointer, keyboard,
// the tvOS focus engine and a D-pad.
import { BlurView } from 'expo-blur';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { display, eyebrow, focusRing, pill } from '../../../../../client/src/skin/vela-base/look';
import { field as fieldRows } from '../../../../../client/src/skin/vela-base/auth';
import { SYMBOLS } from '../../icons';
import type { Css } from '../../translate';
import { useLook } from './look';

const web = Platform.OS === 'web';
/** A pressable that runs the look's CSS transitions (background, scale) as a document box does. */
export const APressable = Animated.createAnimatedComponent(Pressable);
/** The platform ring is replaced by the control's own focus look. */
export const NO_RING = (web ? { outlineWidth: 0 } : {}) as ViewStyle;

export interface Interaction {
  hover: boolean;
  focus: boolean;
  pressed: boolean;
}

/** Hover, focus and pressed for one control, with the handlers that keep them. */
export function useInteraction() {
  const [state, setState] = useState<Interaction>({ hover: false, focus: false, pressed: false });
  const set = (key: keyof Interaction, on: boolean) => setState(s => (s[key] === on ? s : { ...s, [key]: on }));
  const handlers = {
    onHoverIn: () => set('hover', true),
    onHoverOut: () => set('hover', false),
    onFocus: () => set('focus', true),
    onBlur: () => set('focus', false),
    onPressIn: () => set('pressed', true),
    onPressOut: () => set('pressed', false),
  };
  return { state, handlers };
}

/** Rows with the overlays in force: hover, then focus (on TV, focus also shows the hover look). */
export function overlaid(rows: Css, state: Interaction, looks: { hover?: Css; focus?: Css; disabled?: Css }, disabled = false): Css {
  const out = { ...rows };
  if (disabled) return Object.assign(out, looks.disabled);
  if (state.hover || (Platform.isTV && state.focus)) Object.assign(out, looks.hover);
  if (state.focus) Object.assign(out, looks.focus);
  return out;
}

export function Words({ rows, lines, children, style, ...a11y }: {
  rows: Css;
  lines?: number;
  children: ReactNode;
  style?: TextStyle;
  accessibilityRole?: 'header' | 'alert' | 'text';
  testID?: string;
}) {
  const look = useLook();
  return (
    <Text style={[look.text(rows), style]} numberOfLines={lines} ellipsizeMode={lines ? 'tail' : undefined} {...a11y}>
      {children}
    </Text>
  );
}

export function Glyph({ symbol, size, color }: { symbol: string; size: number; color: string }) {
  const glyph = SYMBOLS[symbol];
  if (!glyph) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" pointerEvents="none">
      {glyph.paths.map((d, i) => glyph.stroke
        ? <Path key={i} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        : <Path key={i} d={d} fill={color} />)}
    </Svg>
  );
}

/** An eyebrow over a display title, as the base's sign-in heads its card. */
export function Heading({ eyebrow: over, title, lines = 2 }: { eyebrow?: string; title: string; lines?: number }) {
  return (
    <View style={{ gap: 10 }}>
      {over ? <Words rows={{ ...eyebrow, 'font-size': '10px', color: '$ui.accent' }}>{over}</Words> : null}
      <Words rows={{ ...display, 'font-size': '42px' }} lines={lines} accessibilityRole="header">{title}</Words>
    </View>
  );
}

export function Label({ children }: { children: string }) {
  return <Words rows={{ ...eyebrow, 'font-size': '10px', color: '$ui.inkQuiet' }}>{children}</Words>;
}

/** A failure the viewer should read: announced, in the accent ink. */
export function Alert({ children }: { children: string }) {
  return <Words rows={{ 'font-size': '14px', 'line-height': '1.5', color: '$ui.accent' }} accessibilityRole="alert">{children}</Words>;
}

/** The base's waiting mark: three breathing dots, still under reduced motion. */
export function Pulse() {
  const look = useLook();
  const dot = look.box({ width: '7px', height: '7px', 'border-radius': '4px', 'background-color': '$ui.accent' });
  return (
    <View style={{ flexDirection: 'row', gap: 8 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 180, 360].map(delay => (
        <Animated.View key={delay} style={[dot, look.still ? { opacity: 0.8 } : look.motion(`velaPulse${delay}`)]} />
      ))}
    </View>
  );
}

/** A waiting line: the pulse beside what is being waited for. */
export function Waiting({ children }: { children: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }} accessibilityRole="text" accessibilityLiveRegion="polite">
      <Pulse />
      <Words rows={{ 'font-size': '14px', color: '$ui.inkSecondary' }}>{children}</Words>
    </View>
  );
}

/** A code drawn one tile per character, read aloud whole. */
export function CodeTiles({ code, testID }: { code: string; testID?: string }) {
  const look = useLook();
  const tile = look.box({
    flex: '1',
    'max-width': '44px',
    height: '54px',
    'align-items': 'center',
    'justify-content': 'center',
    'border-radius': '12px',
    'background-color': '#0c0e12e6',
    border: '1px solid $ui.glassEdge',
    'box-shadow': 'inset 0px 1px 0px #ffffff2e',
  });
  const ink = look.text({
    'font-family': 'ui-monospace, "SF Mono", Menlo, monospace',
    'font-size': '24px',
    'font-weight': '600',
    color: '$ui.accent',
  });
  return (
    <View style={{ flexDirection: 'row', width: '100%', gap: 6, justifyContent: 'center' }} accessible accessibilityLabel={code} testID={testID}>
      {[...code].map((char, i) => (
        <Animated.View key={i} style={[tile, look.motion('velaCodeIn', i, { step: 45, cap: 12 })]}>
          <Text style={ink}>{char}</Text>
        </Animated.View>
      ))}
    </View>
  );
}

interface PillProps {
  label: string;
  onPress(): void;
  primary?: boolean;
  height?: number;
  disabled?: boolean;
  /** Draws the pulse in place of the label's start while something is in flight. */
  busy?: boolean;
  testID?: string;
  /** Fill the row (sign-in buttons) or hug the label (Cancel). */
  stretch?: boolean;
  children?: ReactNode;
}

/** The base's pill button: primary in ink, or ghost glass. */
export function Pill({ label, onPress, primary = false, height = 52, disabled = false, busy = false, testID, stretch = true, children }: PillProps) {
  const look = useLook();
  const { state, handlers } = useInteraction();
  const rows = overlaid(
    { ...pill(primary, height), 'padding-left': '28px', 'padding-right': '28px', ...(stretch ? {} : { 'align-self': 'flex-start' }) },
    state,
    {
      hover: primary ? { 'background-color': '#ffffff' } : { 'background-color': '$ui.controlHover', 'border-color': '$ui.glassEdgeStrong' },
      focus: { 'box-shadow': focusRing },
      disabled: primary ? { 'background-color': '$ui.controlHover', color: '$ui.inkQuiet' } : { opacity: '0.42' },
    },
    disabled,
  );
  const { style, blur } = look.layer(rows);
  const ink = look.text({ color: rows.color, 'font-size': '15px', 'font-weight': rows['font-weight'] });
  return (
    <APressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled, busy }} testID={testID} {...handlers}
      style={[style, { flexDirection: 'row', gap: 10, overflow: 'hidden' }, state.pressed && !disabled ? { opacity: 0.65 } : null, NO_RING]}>
      {blur && !web ? <BlurView intensity={Math.min(100, Math.round(blur * 2.5))} tint="dark" style={StyleSheet.absoluteFill} /> : null}
      {busy ? <Pulse /> : null}
      {children}
      <Text style={ink}>{label}</Text>
    </APressable>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText(value: string): void;
  onSubmit?(): void;
  secure?: boolean;
  kind?: 'url' | 'username' | 'password';
  placeholder?: string;
  testID?: string;
}

const KINDS = {
  url: { autoComplete: 'url', content: 'URL', keyboard: 'url', submit: 'go' },
  username: { autoComplete: 'username', content: 'username', keyboard: 'default', submit: 'next' },
  password: { autoComplete: 'current-password', content: 'password', keyboard: 'default', submit: 'go' },
} as const;

/** The base's sign-in field: a label over a glass input that rings in the accent on focus. */
export function Field({ label, value, onChangeText, onSubmit, kind = 'username', placeholder, testID }: FieldProps) {
  const look = useLook();
  const { state, handlers } = useInteraction();
  const rows = overlaid(fieldRows as Css, state, {
    hover: { 'border-color': '$ui.glassEdgeStrong' },
    focus: { 'border-color': '$ui.accent', 'box-shadow': '0px 0px 0px 4px $ui.focusHalo' },
  });
  const box = look.box(rows);
  const ink = look.text({ 'font-size': rows['font-size'] ?? '16px', color: rows.color ?? '$ui.ink' });
  const traits = KINDS[kind];
  return (
    <View style={{ gap: 8 }}>
      <Label>{label}</Label>
      <Animated.View style={box} onPointerEnter={handlers.onHoverIn} onPointerLeave={handlers.onHoverOut}>
        <TextInput value={value} onChangeText={onChangeText} onSubmitEditing={onSubmit} secureTextEntry={kind === 'password'}
          autoComplete={traits.autoComplete} textContentType={traits.content} keyboardType={traits.keyboard} returnKeyType={traits.submit}
          autoCapitalize="none" autoCorrect={false} spellCheck={false} placeholder={placeholder}
          placeholderTextColor={look.ui.inkQuiet} accessibilityLabel={label} testID={testID}
          onFocus={handlers.onFocus} onBlur={handlers.onBlur}
          style={[ink, { flex: 1, alignSelf: 'stretch', minWidth: 0, padding: 0 }, NO_RING as TextStyle]} />
      </Animated.View>
    </View>
  );
}
