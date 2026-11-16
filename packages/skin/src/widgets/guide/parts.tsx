// Small pieces every Live TV surface draws with: a symbol, a line of text in the guide's type, a
// pressable that knows its hover and focus, the live badge, a progress bar and a channel logo
// fitted on its neutral tile.
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { msg } from '@vela/core';
import { SYMBOLS } from '../../icons';
import { monogram } from './geometry';
import type { GuideLook } from './look';

export function Glyph({ name, size, color }: { name: string; size: number; color: string }) {
  const symbol = SYMBOLS[name];
  if (!symbol) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" pointerEvents="none">
      {symbol.paths.map((d, i) =>
        symbol.stroke ? (
          <Path key={i} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <Path key={i} d={d} fill={color} />
        ),
      )}
    </Svg>
  );
}

interface LineProps {
  look: GuideLook;
  size: number;
  weight?: number;
  color?: string;
  /** Lines before the text ends in an ellipsis; 0 lets it wrap. */
  lines?: number;
  tabular?: boolean;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
}

/** Text in the document's body face. */
export function Line({ look, size, weight = 400, color, lines = 1, tabular, style, children }: LineProps) {
  const face = look.font(weight);
  const variant: TextStyle = tabular ? { fontVariant: ['tabular-nums'] } : {};
  return (
    <Text
      numberOfLines={lines || undefined}
      style={[face, { fontSize: size, color: color ?? look.ink }, variant, style]}
    >
      {children}
    </Text>
  );
}

/** The press layer draws its own focus look, so the browser's outline stays off. */
const WEB_PRESS = { outlineStyle: 'none', cursor: 'pointer' } as unknown as ViewStyle;

export interface Interaction {
  hovered: boolean;
  focused: boolean;
  pressed: boolean;
}

interface PressProps {
  onPress?: () => void;
  onFocus?: () => void;
  label: string;
  style: (state: Interaction) => StyleProp<ViewStyle>;
  children: ReactNode | ((state: Interaction) => ReactNode);
  nativeID?: string;
  testID?: string;
  selected?: boolean;
  role?: 'button' | 'tab' | 'togglebutton';
  /** Web keyboard: a key pressed while this has focus. */
  onKey?: (key: string, prevent: () => void) => void;
  /** Whether the TV focus engine may land here. */
  focusable?: boolean;
  hasTVPreferredFocus?: boolean;
}

/** A pressable that tracks its own hover and focus, so focus looks work on web, TV and touch alike. */
export function Press(props: PressProps) {
  const { onPress, onFocus, label, style, children, nativeID, testID, selected, role = 'button', onKey } = props;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const state = { hovered, focused, pressed };
  // react-native-web hands Pressable its DOM key events; native TV moves focus itself.
  const keys =
    Platform.OS === 'web' && onKey
      ? {
          onKeyDown: (e: { nativeEvent: object; preventDefault(): void }) =>
            onKey((e.nativeEvent as { key?: string }).key ?? '', () => e.preventDefault()),
        }
      : {};
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      accessibilityRole={role === 'togglebutton' ? 'togglebutton' : role === 'tab' ? 'tab' : 'button'}
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      nativeID={nativeID}
      testID={testID}
      focusable={props.focusable}
      hasTVPreferredFocus={props.hasTVPreferredFocus}
      style={[style(state), Platform.OS === 'web' ? WEB_PRESS : null]}
      {...keys}
    >
      {typeof children === 'function' ? children(state) : children}
    </Pressable>
  );
}

/** The broadcast "LIVE" badge. */
export function LiveBadge({ look, size = 10 }: { look: GuideLook; size?: number }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 6,
        alignItems: 'center',
        paddingVertical: 2,
        paddingHorizontal: 7,
        borderRadius: 6,
        backgroundColor: look.now,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: look.ink }} />
      <Line look={look} size={size} weight={750} style={{ letterSpacing: size * 0.14 }}>
        {msg('live.liveBadge')}
      </Line>
    </View>
  );
}

/** A thin progress track, filled to `percent`. */
export function Progress({
  look,
  percent,
  height = 3,
  width,
  flex,
  color,
}: {
  look: GuideLook;
  percent: number;
  height?: number;
  width?: number;
  flex?: number;
  color?: string;
}) {
  const fill = `${Math.max(0, Math.min(100, percent))}%` as const;
  return (
    <View style={{ width, flex, height, borderRadius: height, backgroundColor: look.track, overflow: 'hidden' }}>
      <View style={{ height, width: fill, backgroundColor: color ?? look.accent }} />
    </View>
  );
}

/** A channel's logo contained on a neutral tile, or its monogram. */
export function LogoTile({
  look,
  logo,
  name,
  width,
  height,
  radius = 8,
  size = 13,
}: {
  look: GuideLook;
  logo: string;
  name: string;
  width: number;
  height: number;
  radius?: number;
  size?: number;
}) {
  return (
    <View
      style={{
        width,
        height,
        flexShrink: 0,
        borderRadius: radius,
        overflow: 'hidden',
        padding: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: look.logoTile,
        borderWidth: 1,
        borderColor: look.hairline,
      }}
    >
      {logo ? (
        <Image
          source={{ uri: logo }}
          contentFit="contain"
          style={{ width: '100%', height: '100%' }}
          accessible={false}
        />
      ) : (
        <Line look={look} size={size} weight={750} color={look.inkSecondary} style={{ letterSpacing: size * 0.04 }}>
          {monogram(name)}
        </Line>
      )}
    </View>
  );
}
