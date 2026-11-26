// The stage the foundation's own pages stand on (Connect a server): the Vela base sign-in's
// drifting light on the page colour, the brand mark, and a glass card that holds the page,
// sized to the safe viewport; long lists scroll inside the card and keyboard scrolling stays bounded.
// Styled from the active document's `ui`.
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useEffect, useState, type ReactNode } from 'react';
import { authLayout, keyboardAvoidanceEnabled } from './layout';
import { AuthLayoutContext } from './layout-context';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, Text } from 'react-native';
import Animated from 'react-native-reanimated';
import { useHost } from '../../host';
import type { Css } from '../../translate';
import { luminance } from '../../screen/colour';
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
  'max-width': '480px',
  padding: 'clamp(28px, 5vw, 44px) clamp(22px, 4.5vw, 40px)',
  'border-radius': '$ui.radiusPanel',
  'background-color': '$ui.glass',
  'backdrop-filter': 'blur(28px) saturate(1.4)',
  border: '1px solid $ui.glassEdge',
  'box-shadow': '0px 40px 120px #00000088, inset 0px 1px 0px #ffffff2e',
  overflow: 'hidden',
};

export function Stage({ children, branding }: { children: ReactNode; branding?: {wordmark: string; name?: string} }) {
  const look = useLook();
  const host = useHost();
  const [availableHeight, setAvailableHeight] = useState(host.viewport.height);
  const [webHeight, setWebHeight] = useState<number | undefined>();
  useEffect(() => {
    if (Platform.OS !== 'web' || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const resize = () => setWebHeight(viewport.height);
    resize();
    viewport.addEventListener('resize', resize);
    return () => viewport.removeEventListener('resize', resize);
  }, []);
  const layout = authLayout(host.viewport, availableHeight, Platform.isTV, Platform.OS !== 'web' || (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches));
  const mark = host.image(branding?.wordmark || (luminance(look.ui.page) > 0.5 ? 'assets/brand/vela-stacked-paper.svg' : 'assets/brand/vela-stacked.svg'));
  const card = look.layer(CARD);
  return (
    <KeyboardAvoidingView
      style={[StyleSheet.absoluteFill, { backgroundColor: look.ui.page }]}
      enabled={keyboardAvoidanceEnabled(Platform.OS, Platform.isTV)}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
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
      <View style={{ flex: 1, maxHeight: webHeight }} onLayout={event => setAvailableHeight(event.nativeEvent.layout.height)}>
      <ScrollView
        testID="auth-stage-scroll"
        style={{ flex: 1 }}
        contentContainerStyle={[look.box({
          'flex-grow': '1',
          'align-items': 'center',
          'justify-content': 'center',
          gap: `${layout.gap}px`,
          padding: 'max(28px, 7vh) 16px',
        }), { paddingLeft: (host.viewport.sides?.left ?? 0) + 16, paddingRight: (host.viewport.sides?.right ?? 0) + 16, paddingTop: Math.max(layout.padding, host.viewport.insets.top), paddingBottom: Math.max(layout.padding, host.viewport.insets.bottom) }, layout.compact && { paddingLeft: (host.viewport.sides?.left ?? 0) + layout.padding, paddingRight: (host.viewport.sides?.right ?? 0) + layout.padding, paddingTop: host.viewport.insets.top + layout.padding, paddingBottom: host.viewport.insets.bottom + layout.padding, gap: layout.gap }]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        {branding?.name && !branding.wordmark ? <Text style={{color: look.ui.ink, fontSize: 28, fontWeight: '700'}}>{branding.name}</Text> : mark && layout.logoHeight ? <Image source={mark} contentFit="contain" style={{ width: branding?.wordmark ? 220 : layout.logoHeight * 60 / 104, height: layout.logoHeight }} accessibilityElementsHidden /> : null}
        <Animated.View testID="auth-card" style={[card.style, { maxHeight: !layout.compact || availableHeight < host.viewport.height - 100 ? undefined : layout.cardHeight }, layout.tight && { padding: layout.padding }, layout.compact && { maxWidth: '100%', width: '100%' }, look.motion('velaEnter0')]}>
          {card.blur && Platform.OS !== 'web' ? (
            <BlurView
              intensity={Math.min(100, Math.round(card.blur * 2.5))}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <AuthLayoutContext.Provider value={layout}>{children}</AuthLayoutContext.Provider>
        </Animated.View>
      </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
