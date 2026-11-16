// The foundation's search field: what home's `searchField` slot holds (docs/skin-schema.md), as
// compiled Cinematic's SearchField drew it, on the document's ui look: a glass pill with the
// search glyph, the query (env.query) and a clear button while there is one. A document that
// draws its own field places the bare `searchInput` widget instead.
import { msg } from '@vela/core';
import { BlurView } from 'expo-blur';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { resolveUi } from '../../../../../client/src/skin/ui';
import { measure, useHost, type WidgetProps } from '../../host';
import { SYMBOLS } from '../../icons';
import { textStyle } from '../../translate';

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
  const ui = useMemo(() => resolveUi(host.doc.document.ui), [host.doc.document]);
  const [focused, setFocused] = useState(false);
  const [clearHover, setClearHover] = useState(false);
  const text = useMemo(
    () => textStyle({ 'font-family': ui.font, 'font-size': '17px', color: ui.ink }, measure(host.viewport, 17)).style,
    [ui, host.viewport],
  );

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
  const focus = (on: boolean) => {
    setFocused(on);
    host.setFlag('search-focused', on);
  };

  return (
    <View style={[styles.field, field]}>
      <BlurView intensity={65} tint="dark" style={StyleSheet.absoluteFill} />
      <Glyph symbol="search" size={20} color={focused ? ui.ink : ui.inkSecondary} />
      <TextInput
        value={host.env.query}
        onChangeText={host.setQuery}
        placeholder={msg('ui.aTitleAFeelingAWorldToGetLostIn')}
        placeholderTextColor={ui.inkQuiet}
        accessibilityLabel={msg('ui.searchYourLibrary')}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        testID={`search-${ctx.index}`}
        nativeID="vela-search"
        onFocus={() => focus(true)}
        onBlur={() => focus(false)}
        style={[text, styles.input] as TextStyle[]}
      />
      {host.env.query !== '' ? (
        <Pressable
          onPress={() => host.setQuery('')}
          accessibilityRole="button"
          accessibilityLabel={msg('ui.clearSearch')}
          onHoverIn={() => setClearHover(true)}
          onHoverOut={() => setClearHover(false)}
          style={[
            styles.clear,
            {
              // Concentric with the field: its corner less the clear button's inset.
              borderRadius: Math.max(0, radius - (FIELD_HEIGHT - CLEAR_SIZE) / 2),
              backgroundColor: clearHover ? ui.controlHover : ui.control,
            },
          ]}
        >
          <Glyph symbol="close" size={16} color={ui.ink} />
        </Pressable>
      ) : null}
    </View>
  );
}

const FIELD_HEIGHT = 60;
const CLEAR_SIZE = 40;

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
