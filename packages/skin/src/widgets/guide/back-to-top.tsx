// Back to top: a small floating control over a guide scrolled deep (pointer, touch and keyboard;
// a TV remote has Back for this). It takes the guide back to its first channel at now.
import { View } from 'react-native';
import { msg } from '@vela/core';
import type { GuideLook } from './look';
import { Glyph, Line, Press } from './parts';
import { useHost } from '../../host';

export function BackToTop({ look, onPress }: { look: GuideLook; onPress(): void }) {
  const { insets } = useHost().viewport;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', right: 16 + insets.right, bottom: 16 + insets.bottom, zIndex: 20 }}>
      <Press
        lift
        label={msg('live.backToTop')}
        testID="guide-back-to-top"
        role="button"
        onPress={onPress}
        style={({ hovered, focused, pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 40,
          paddingLeft: 12,
          paddingRight: 16,
          borderRadius: look.radiusControl,
          borderWidth: 1,
          borderColor: look.edge,
          backgroundColor: hovered ? look.ui.raised : look.ui.popover,
          transform: [{ scale: pressed ? 0.96 : 1 }],
          boxShadow: focused
            ? `0px 0px 0px 2px ${look.accent}, 0px 12px 32px ${look.shadow}`
            : `0px 12px 32px ${look.shadow}`,
        })}
      >
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <Glyph name="back" size={16} color={look.ink} />
        </View>
        <Line look={look} size={14} weight={600}>{msg('live.backToTop')}</Line>
      </Press>
    </View>
  );
}
