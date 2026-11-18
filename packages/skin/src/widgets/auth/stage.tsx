// The stage the foundation's own pages stand on (Connect a server): the Vela base sign-in's
// drifting light on the page colour, the brand mark, and a glass card that holds the page,
// centred and scrolling when it is taller than the screen. Styled from the document's `ui`.
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useHost } from '../../host';
import type { Css } from '../../translate';
import { useLook } from '../common/look';

const AURORAS: { motion: string; rows: Css }[] = [
  {
    motion: 'velaAuroraA',
    rows: {
      width: '72vmax',
      height: '72vmax',
      left: '-22vmax',
      top: '-30vmax',
      opacity: '0.5',
      'background-image': 'radial-gradient(circle, #c0703f 0%, #090b0e00 68%)',
    },
  },
  {
    motion: 'velaAuroraB',
    rows: {
      width: '80vmax',
      height: '80vmax',
      right: '-30vmax',
      bottom: '-42vmax',
      opacity: '0.55',
      'background-image': 'radial-gradient(circle, #1f5a6b 0%, #090b0e00 66%)',
    },
  },
  {
    motion: 'velaAuroraC',
    rows: {
      width: '54vmax',
      height: '54vmax',
      left: '34%',
      top: '18%',
      opacity: '0.35',
      'background-image': 'radial-gradient(circle, #5b2a4a 0%, #090b0e00 70%)',
    },
  },
];

const CARD: Css = {
  width: '100%',
  'flex-shrink': '0',
  'max-width': '448px',
  padding: 'clamp(28px, 5vw, 44px) clamp(22px, 4.5vw, 40px)',
  'border-radius': '$ui.radiusPanel',
  'background-color': '$ui.glass',
  'backdrop-filter': 'blur(28px) saturate(1.4)',
  border: '1px solid $ui.glassEdge',
  'box-shadow': '0px 40px 120px #00000088, inset 0px 1px 0px #ffffff2e',
  overflow: 'hidden',
};

export function Stage({ children }: { children: ReactNode }) {
  const look = useLook();
  const host = useHost();
  const mark = host.image('assets/brand/vela-stacked.svg');
  const card = look.layer(CARD);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: look.ui.page }]}>
      <View
        style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {AURORAS.map(aurora => (
          <Animated.View
            key={aurora.motion}
            style={[
              look.box({ position: 'absolute', 'border-radius': '9999px', ...aurora.rows }),
              look.motion(aurora.motion),
            ]}
          />
        ))}
        <View
          style={[
            StyleSheet.absoluteFill,
            look.box({
              'background-image': 'radial-gradient(ellipse 110% 85% at 50% 42%, #090b0e00 35%, #000000b3 100%)',
            }),
          ]}
        />
      </View>
      <ScrollView
        contentContainerStyle={look.box({
          'flex-grow': '1',
          'align-items': 'center',
          'justify-content': 'center',
          gap: '32px',
          padding: 'max(28px, 7vh) 16px',
        })}
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
      >
        {mark ? <Image source={mark} style={{ width: 60, height: 104 }} accessibilityElementsHidden /> : null}
        <Animated.View style={[card.style, look.motion('velaEnter0')]}>
          {card.blur && Platform.OS !== 'web' ? (
            <BlurView
              intensity={Math.min(100, Math.round(card.blur * 2.5))}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          {children}
        </Animated.View>
      </ScrollView>
    </View>
  );
}
