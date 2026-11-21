// The foundation's search field: what home's `searchField` slot holds (docs/skin-schema.md), as
// compiled Cinematic's SearchField drew it, on the document's ui look: a glass pill with the
// search glyph, the query (env.query) and a clear button while there is one. A document that
// draws its own field places the bare `searchInput` widget instead.
import { FocusPressable as Pressable } from '../../focus';
import { Pressable as PlainPressable } from 'react-native';
import { msg } from '@vela/core';
import { BlurView } from 'expo-blur';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';
import { TextField } from '../common/text-field';
import Svg, { Path } from 'react-native-svg';
import { useQueryText } from './query-text';
import { resolveUi } from '../../resolve/ui';
import { type Focusable } from '../../escape';
import { useSearchFocus } from './use-search-focus';
import { useRouteFocusContext } from '../../route-focus';
import { RevealContext } from '../../tv-reveal';
import { measure, useHost, type WidgetProps } from '../../host';
import { SYMBOLS } from '../../icons';
import { fontSizeOf, textStyle } from '../../translate';
import { placeholderRows } from './placeholder-text';

function Glyph({ symbol, size, color }: { symbol: 'search' | 'close'; size: number; color: string }) {
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {SYMBOLS[symbol].paths.map(d => (
          <Path key={d} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </Svg>
    </View>
  );
}

export function SearchField({ ctx }: WidgetProps) {
  const host = useHost();
  const query = useQueryText();
  const ui = useMemo(() => resolveUi(host.doc.document.ui), [host.doc.document]);
  const [focused, setFocused] = useState(false);
  const [clearHover, setClearHover] = useState(false);
  // On TV the focused clear button fills with the ink, as the player's controls do.
  const [clearFocus, setClearFocus] = useState(false);
  const clearLit = Platform.isTV && clearFocus;
  // Typed text in the body size and ink; while empty the field draws its placeholder as the
  // document's secondary text (placeholder-text.ts).
  const { text, quiet } = useMemo(() => {
    const rows = { 'font-family': ui.font, 'font-size': '17px', color: ui.ink };
    const m = measure(host.viewport, 17);
    const hint = placeholderRows(rows, fontSizeOf(rows['font-size'], 17, m), fontSizeOf('100px', 17, m) / 100);
    return {
      text: textStyle(rows, measure(host.viewport, 17)).style,
      quiet: textStyle(hint.rows, measure(host.viewport, hint.fontSize)).style,
    };
  }, [ui, host.viewport]);

  // The document's control corners: a pill by default, square for square-control documents.
  const radius = Math.min(ui.radiusControl, FIELD_HEIGHT / 2);
  const field: ViewStyle = {
    borderRadius: radius,
    backgroundColor: ui.glass,
    borderColor: focused ? ui.glassEdgeStrong : ui.glassEdge,
    boxShadow: focused
      ? `0px 26px 70px #00000040, 0px 0px 0px 3px ${ui.focusHalo}, inset 0px 1px 0px ${ui.glassEdge}`
      : `0px 18px 50px #00000040, inset 0px 1px 0px ${ui.glassEdge}`,
  };
  // On TV, the field taking focus settles the route's first focus (results drawn as the viewer
  // types never take it from the field), and on Android TV it is kept below the shell's bar.
  const routeFocus = useRouteFocusContext();
  const reveal = useContext(RevealContext);
  const frame = useRef<Focusable | null>(null);
  const onTvFocus = () => {
    routeFocus?.focused();
    if (reveal && frame.current) reveal(frame.current);
  };
  const focus = (on: boolean) => {
    setFocused(on);
    host.setFlag('search-focused', on);
    if (on) onTvFocus();
  };

  // The search actions (`search`, `focusSearch`) focus the field by its id: the text input itself,
  // which on a TV opens the system keyboard.
  const input = useSearchFocus();
  const placeholder = host.env.home?.descriptiveAvailable
    ? msg('ui.searchPlaceholderDescriptive')
    : msg('ui.searchPlaceholder');
  const clearOnEscape = Platform.OS === 'web' ? { onKeyPress: (event: { nativeEvent: { key: string }; preventDefault?(): void }) => {
    if (event.nativeEvent.key !== 'Escape' || query.text === '') return;
    event.preventDefault?.();
    query.change('');
  } } : {};

  // On a TV the field is a focus destination of its own (the focus engine skips a bare text input
  // here): the remote moves onto it, and selecting it opens the keyboard. The clear button sits
  // beside that destination, not inside it: the focus engine never focuses a focusable view's
  // subviews, so a clear button inside could not be reached.
  const [tvFocused, setTvFocused] = useState(false);
  // Opening search folds what stands above the field (the hero's copy) and moves it up under the
  // bar without a focus change: once the page has settled, a focused field is brought back below.
  const searching = host.env.query !== '';
  const held = focused || tvFocused;
  useEffect(() => {
    if (!reveal || !held) return;
    const timer = setTimeout(() => frame.current && reveal(frame.current), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [searching]);
  // The entry inside the field takes TV focus, but the field draws the ring (below) around its whole
  // box: the shared focus look on the entry itself would show only as a line cut by the field's edge.
  const Frame = Platform.isTV ? PlainPressable : View;
  const tvProps = Platform.isTV
    ? {
        onPress: () => input.current?.focus(),
        onFocus: () => {
          setTvFocused(true);
          onTvFocus();
        },
        onBlur: () => setTvFocused(false),
        accessibilityRole: 'search' as const,
        accessibilityLabel: msg('ui.searchYourLibrary'),
      }
    : {};
  const ring = tvFocused && !focused
    ? { borderColor: '#ffffff', boxShadow: '0px 0px 0px 2px #ffffff, 0px 0px 0px 6px #101216' }
    : null;

  return (
    <View style={[styles.field, field, ring]}>
      {/* Android has no blur target here; its dark fallback tint hides light skins' glass. */}
      {Platform.OS !== 'android' && <BlurView intensity={65} tint="dark" style={StyleSheet.absoluteFill} />}
      <Frame ref={frame as never} style={styles.entry} {...tvProps}>
        <Glyph symbol="search" size={20} color={focused ? ui.ink : ui.inkSecondary} />
        <TextField
          ref={input}
          value={query.text}
          onChangeText={query.change}
          placeholder={placeholder}
          placeholderTextColor={ui.inkQuiet}
          accessibilityLabel={msg('ui.searchYourLibrary')}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          testID={`search-${ctx.index}`}
          nativeID="vela-search"
          {...clearOnEscape}
          onFocus={() => focus(true)}
          onBlur={() => focus(false)}
          style={[query.text === '' ? quiet : text, styles.input] as TextStyle[]}
        />
      </Frame>
      {query.text !== '' ? (
        <Pressable
          onPress={() => {
            query.change('');
            // On TV the button leaves with the text: focus goes back to the field, not nowhere.
            if (Platform.isTV) requestAnimationFrame(() => frame.current?.requestTVFocus?.());
          }}
          accessibilityRole="button"
          accessibilityLabel={msg('ui.clearSearch')}
          onHoverIn={() => setClearHover(true)}
          onHoverOut={() => setClearHover(false)}
          onFocus={() => setClearFocus(true)}
          onBlur={() => setClearFocus(false)}
          style={[
            styles.clear,
            {
              // Concentric with the field: its corner less the clear button's inset.
              borderRadius: Math.max(0, radius - (FIELD_HEIGHT - CLEAR_SIZE) / 2),
              backgroundColor: clearLit ? ui.ink : clearHover || clearFocus ? ui.controlHover : ui.control,
            },
          ]}
        >
          <Glyph symbol="close" size={16} color={clearLit ? ui.inkInverse : ui.ink} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** How long opening search takes to lay out before the field is checked against the bar. */
const SETTLE_MS = 250;
const FIELD_HEIGHT = 60;
const CLEAR_SIZE = 44;

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    height: FIELD_HEIGHT,
    paddingLeft: 22,
    paddingRight: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  // The search destination: the glyph and the text, before the clear button.
  entry: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  // Positioned, so the text paints over the blur layer.
  input: {
    position: 'relative',
    flex: 1,
    minWidth: 0,
    height: '100%',
    padding: 0,
    backgroundColor: 'transparent',
    // The field draws its own focus (the halo); the browser's ring would sit inside it.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : {}),
  },
  clear: {
    width: CLEAR_SIZE,
    height: CLEAR_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
