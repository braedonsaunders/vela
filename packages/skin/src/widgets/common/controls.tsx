// The foundation surfaces' controls, in the Vela base's look (packages/skin/src/resolve/vela-base): pills,
// fields, the waiting pulse, a code drawn one tile per character, headings and alerts. Each
// tracks its own hover, focus and pressed states, so the same look works by pointer, keyboard,
// the tvOS focus engine and a D-pad.
import { FocusPressable as Pressable } from '../../focus';
import type { Focusable } from '../../escape';
import { BlurView } from 'expo-blur';
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref, type ComponentRef } from 'react';
import { Platform, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useAuthLayout } from '../auth/layout-context';
import { DISPLAY_LINE_HEIGHT } from '../auth/layout';
import { TextField } from './text-field';
import { ownKeyboard, RETURN_FOCUS_MS, TvKeyboard } from './tv-keyboard';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { display, eyebrow, focusRing, pill } from '../../resolve/vela-base/look';
import { field as fieldRows } from '../../resolve/vela-base/auth';
import { SYMBOLS } from '../../icons';
import type { Css } from '../../translate';
import { useLook } from './look';
import { useFocusClaim } from './focus-claim';

const web = Platform.OS === 'web';
/** A pressable that runs the look's CSS transitions (background, scale) as a document box does. */
export const APressable = Animated.createAnimatedComponent(Pressable);
/** The platform ring is replaced by the control's own focus look. */
export const NO_RING = (web ? { outlineStyle: 'none' } : {}) as unknown as ViewStyle;

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
export function overlaid(
  rows: Css,
  state: Interaction,
  looks: { hover?: Css; focus?: Css; disabled?: Css },
  disabled = false,
): Css {
  const out = { ...rows };
  if (disabled) return Object.assign(out, looks.disabled);
  if (state.hover || (Platform.isTV && state.focus)) Object.assign(out, looks.hover);
  if (state.focus) Object.assign(out, looks.focus);
  return out;
}

export function Words({
  rows,
  lines,
  children,
  style,
  maxScale,
  ...a11y
}: {
  rows: Css;
  lines?: number;
  children: ReactNode;
  style?: TextStyle;
  /** The most the viewer's text size may enlarge it (a display title keeps its composition). */
  maxScale?: number;
  accessibilityRole?: 'header' | 'alert' | 'text';
  accessibilityLabel?: string;
  testID?: string;
}) {
  const look = useLook();
  // The signed-out stage keeps its composition at the largest text sizes: words grow, within reason.
  const auth = !!useAuthLayout();
  return (
    <Text style={[look.text(rows), style]} numberOfLines={lines} ellipsizeMode={lines ? 'tail' : undefined} maxFontSizeMultiplier={maxScale ?? (auth ? 1.5 : undefined)} {...a11y}>
      {children}
    </Text>
  );
}

export function Glyph({ symbol, size, color }: { symbol: string; size: number; color: string }) {
  const glyph = SYMBOLS[symbol];
  if (!glyph) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" pointerEvents="none">
      {glyph.paths.map((d, i) =>
        glyph.stroke ? (
          <Path
            key={i}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <Path key={i} d={d} fill={color} />
        ),
      )}
    </Svg>
  );
}

/** An eyebrow over a display title, as the base's sign-in heads its card. */
export function Heading({ eyebrow: over, title, lines = 2, accessibilityLabel }: {
  eyebrow?: string; title: string; lines?: number; accessibilityLabel?: string;
}) {
  const layout = useAuthLayout();
  return (
    <View style={{ gap: layout?.tight ? 4 : 10 }}>
      {over && !layout?.tight ? <Words rows={{ ...eyebrow, 'font-size': '12px', color: '$ui.accent' }}>{over}</Words> : null}
      <Words rows={{ ...display, 'font-size': `${layout?.headingSize ?? 42}px`, 'line-height': String(DISPLAY_LINE_HEIGHT) }} lines={lines} maxScale={1.4}
        accessibilityRole="header" accessibilityLabel={accessibilityLabel} aria-level={1}>
        {title}
      </Words>
    </View>
  );
}

export function Label({ children }: { children: string }) {
  return <Words rows={{ ...eyebrow, 'font-size': '12px', color: '$ui.inkQuiet' }}>{children}</Words>;
}

/** A failure the viewer should read: announced, in the accent ink. On the signed-out stage it is
 * a card of its own, with the alert mark, so a refusal never reads as an ordinary line of text. */
export function Alert({ children }: { children: string }) {
  const centred = !!useAuthLayout();
  const look = useLook();
  if (!centred) {
    return (
      <Words rows={{ 'font-size': '14px', 'line-height': '1.5', color: '$ui.accent' }} accessibilityRole="alert">
        {children}
      </Words>
    );
  }
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="assertive" testID="auth-alert"
      style={[look.box({ 'flex-direction': 'row', gap: '12px', 'align-items': 'flex-start', padding: '14px 16px', 'border-radius': '16px',
        'background-color': '$ui.alert', border: '1px solid $ui.accent' }), { borderColor: `${look.ui.accent}66` }]}>
      <View style={{ paddingTop: 1 }}><Glyph symbol="alert" size={20} color={look.ui.accent} /></View>
      <Words rows={{ 'font-size': '15px', 'line-height': '1.45', color: '$ui.ink' }} style={{ flex: 1 }}>{children}</Words>
    </View>
  );
}

/** The base's waiting mark: three breathing dots, still under reduced motion. */
export function Pulse() {
  const look = useLook();
  const dot = look.box({ width: '7px', height: '7px', 'border-radius': '4px', 'background-color': '$ui.accent' });
  return (
    <View
      style={{ flexDirection: 'row', gap: 8 }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {[0, 180, 360].map(delay => (
        <Animated.View key={delay} style={[dot, look.still ? { opacity: 0.8 } : look.motion(`velaPulse${delay}`)]} />
      ))}
    </View>
  );
}

/** A waiting line: the pulse beside what is being waited for. */
export function Waiting({ children }: { children: string }) {
  const centred = !!useAuthLayout();
  return (
    <View
      style={{ flexDirection: 'row', gap: 10, alignItems: 'center', alignSelf: centred ? 'center' : undefined }}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
    >
      <Pulse />
      <Words rows={{ 'font-size': centred ? '15px' : '14px', color: '$ui.inkSecondary' }}>{children}</Words>
    </View>
  );
}

/** A code drawn one tile per character, read aloud whole. `large`: the code is the page's
 * centrepiece, readable at arm's length. */
export function CodeTiles({ code, testID, large = false }: { code: string; testID?: string; large?: boolean }) {
  const look = useLook();
  const tile = look.box({
    flex: '1',
    'max-width': large ? '64px' : '44px',
    height: large ? '82px' : '54px',
    'align-items': 'center',
    'justify-content': 'center',
    'border-radius': large ? '18px' : '12px',
    'background-color': '#0c0e12e6',
    border: '1px solid $ui.glassEdgeStrong',
    'box-shadow': large ? '0px 18px 40px #00000066, inset 0px 1px 0px #ffffff33' : 'inset 0px 1px 0px #ffffff2e',
  });
  const ink = look.text({
    'font-family': 'ui-monospace, "SF Mono", Menlo, monospace',
    'font-size': large ? '40px' : '24px',
    'font-weight': '600',
    color: '$ui.accent',
  });
  return (
    <View
      style={{ flexDirection: 'row', width: '100%', gap: large ? 10 : 6, justifyContent: 'center' }}
      accessible
      accessibilityLabel={code}
      testID={testID}
    >
      {[...code].map((char, i) => (
        <Animated.View key={i} style={[tile, look.motion('velaCodeIn', i, { step: large ? 90 : 45, cap: 12 })]}>
          <Text style={ink} maxFontSizeMultiplier={1.2}>{char}</Text>
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
  /** Fill the column (sign-in buttons), or hug the label where the column places it (Cancel). */
  align?: 'stretch' | 'center' | 'flex-start';
  children?: ReactNode;
}

/** The base's pill button: primary in ink, or ghost glass. */
export function Pill({
  label,
  onPress,
  primary = false,
  height = 52,
  disabled = false,
  busy = false,
  testID,
  align = 'stretch',
  children,
}: PillProps) {
  const look = useLook();
  const { state, handlers } = useInteraction();
  const rows = overlaid(
    {
      ...pill(primary, height),
      'padding-left': '28px',
      'padding-right': '28px',
      'align-self': align,
    },
    state,
    {
      hover: primary
        ? { 'background-color': '#ffffff' }
        : { 'background-color': '$ui.controlHover', 'border-color': '$ui.glassEdgeStrong' },
      focus: { 'box-shadow': focusRing },
      disabled: primary ? { 'background-color': '$ui.controlHover', color: '$ui.inkQuiet' } : { opacity: '0.42' },
    },
    disabled,
  );
  const { style, blur } = look.layer(rows);
  const ink = look.text({ color: rows.color, 'font-size': '15px', 'font-weight': rows['font-weight'] });
  return (
    <APressable
      onPress={onPress}
      disabled={disabled}
      focusable={!disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      testID={testID}
      {...handlers}
      style={[
        style,
        { flexDirection: 'row', gap: 10, overflow: 'hidden', flexShrink: 0 },
        state.pressed && !disabled ? { opacity: 0.65 } : null,
        NO_RING,
      ]}
    >
      {blur && !web ? (
        <BlurView intensity={Math.min(100, Math.round(blur * 2.5))} tint="dark" style={StyleSheet.absoluteFill} />
      ) : null}
      {busy ? <Pulse /> : null}
      {children}
      <Text style={ink} numberOfLines={1} maxFontSizeMultiplier={1.3}>{label}</Text>
    </APressable>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText(value: string): void;
  onSubmit?(): void;
  inputRef?: Ref<ComponentRef<typeof TextField>>;
  secure?: boolean;
  kind?: 'url' | 'username' | 'password';
  placeholder?: string;
  testID?: string;
  /** Android TV's own keyboard: the words on its done key (Done, Next by default for a username). */
  doneLabel?: string;
  /** On a TV, the field takes focus as its step appears (the address, then the username). */
  preferred?: boolean;
  /** No label drawn above it: the label is the placeholder (still its accessible name). */
  bare?: boolean;
}

const KINDS = {
  url: { autoComplete: 'url', content: 'URL', keyboard: 'url', submit: 'go' },
  username: { autoComplete: 'username', content: 'username', keyboard: 'default', submit: 'next' },
  password: { autoComplete: 'current-password', content: 'password', keyboard: 'default', submit: 'go' },
} as const;

/** The base's sign-in field: a label over a glass input that rings in the accent on focus. */
export function Field(props: FieldProps) {
  return OWN_KEYBOARD ? <KeyboardField {...props} /> : <SystemField {...props} />;
}

const OWN_KEYBOARD = ownKeyboard(Platform.OS, Platform.isTV);

/** Android TV: the field is a button showing the text; selecting it opens Vela's keyboard
 * (tv-keyboard.tsx). `inputRef`'s focus() opens it too (a username's Next opens the password's). */
function KeyboardField({ label, value, onChangeText, onSubmit, kind = 'username', placeholder: hint, testID, inputRef, doneLabel, preferred, bare }: FieldProps) {
  const placeholder = hint ?? (bare ? label : undefined);
  const look = useLook();
  const { state, handlers } = useInteraction();
  const layout = useAuthLayout();
  const [typing, setTyping] = useState(false);
  // The field takes focus back as its keyboard closes (Done or Back): Android otherwise restores
  // whatever its window held before the sheet, or nothing.
  const field = useRef<Focusable | null>(null);
  // A step that appears with nothing focused (the address on launch, the sign-in after the address's
  // Done closed its keyboard) puts focus on its field: Android TV gives a new page none.
  const claim = useFocusClaim(preferred);
  // Asked again once a keyboard that closed as the step appeared has handed focus back to the page.
  useEffect(() => {
    if (!preferred || !Platform.isTV) return;
    const timer = setTimeout(() => field.current?.requestTVFocus?.(), RETURN_FOCUS_MS + 50);
    return () => clearTimeout(timer);
  }, []);
  useImperativeHandle(inputRef, () => ({ focus: () => setTyping(true) }) as unknown as ComponentRef<typeof TextField>, []);
  const rows = overlaid({ ...fieldRows, ...(layout?.tight ? { height: '44px' } : {}) } as Css, state, {
    hover: { 'border-color': '$ui.glassEdgeStrong' },
    focus: { 'border-color': '$ui.accent', 'box-shadow': '0px 0px 0px 4px $ui.focusHalo' },
  });
  const size = rows['font-size'] ?? '16px';
  const shown = kind === 'password' ? '\u2022'.repeat([...value].length) : value;
  return (
    <View style={{ gap: layout?.tight ? 4 : 8 }}>
      {!layout?.minimal && !bare ? <Label>{label}</Label> : null}
      <Pressable
        ref={field as never}
        focusable
        hasTVPreferredFocus={claim}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={kind === 'password' ? undefined : { text: value }}
        testID={testID}
        onPress={() => setTyping(true)}
        onFocus={handlers.onFocus}
        onBlur={handlers.onBlur}
        style={[look.box(rows), { justifyContent: 'center' }, state.focus && { transform: [{ scale: 1.025 }] }]}
      >
        <Text
          numberOfLines={1}
          // The end of a long address is what was just typed.
          ellipsizeMode="head"
          style={look.text({ 'font-size': size, color: value ? (rows.color ?? '$ui.ink') : '$ui.inkQuiet' })}
        >
          {shown || placeholder || ''}
        </Text>
      </Pressable>
      {typing ? (
        <TvKeyboard
          kind={kind}
          label={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          doneLabel={doneLabel ?? (kind === 'username' ? 'Next' : 'Done')}
          onDone={() => {
            setTyping(false);
            onSubmit?.();
          }}
          onClose={() => setTyping(false)}
          returnFocus={field}
          testID={testID ? `${testID}-keyboard` : undefined}
        />
      ) : null}
    </View>
  );
}

function SystemField({ label, value, onChangeText, onSubmit, kind = 'username', placeholder: hint, testID, inputRef, bare }: FieldProps) {
  const placeholder = hint ?? (bare ? label : undefined);
  const look = useLook();
  const { state, handlers } = useInteraction();
  const layout = useAuthLayout();
  const rows = overlaid({ ...fieldRows, ...(layout?.tight ? { height: '44px' } : {}) } as Css, state, {
    hover: { 'border-color': '$ui.glassEdgeStrong' },
    focus: { 'border-color': '$ui.accent', 'box-shadow': '0px 0px 0px 4px $ui.focusHalo' },
  });
  const box = look.box(rows);
  const ink = look.text({ 'font-size': rows['font-size'] ?? '16px', color: rows.color ?? '$ui.ink' });
  const traits = KINDS[kind];
  return (
    <View style={{ gap: layout?.tight ? 4 : 8 }}>
      {!layout?.minimal && !bare ? <Label>{label}</Label> : null}
      <Animated.View style={[box, Platform.isTV && state.focus && { transform: [{ scale: 1.025 }] }]} onPointerEnter={handlers.onHoverIn} onPointerLeave={handlers.onHoverOut}>
        <TextField
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          selectionColor={look.ui.accent}
          secureTextEntry={kind === 'password'}
          autoComplete={traits.autoComplete}
          textContentType={traits.content}
          keyboardType={traits.keyboard}
          returnKeyType={traits.submit}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholder={placeholder}
          placeholderTextColor={look.ui.inkQuiet}
          maxFontSizeMultiplier={1.3}
          accessibilityLabel={label}
          testID={testID}
          onFocus={handlers.onFocus}
          onBlur={handlers.onBlur}
          style={[ink, { flex: 1, alignSelf: 'stretch', minWidth: 0, padding: 0 }, NO_RING as TextStyle]}
        />
      </Animated.View>
    </View>
  );
}
