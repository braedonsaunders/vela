// A passive status surface: never participates in TV focus navigation.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { msg } from '@vela/core';
import { useHost, type WidgetProps } from '../../host';
import { useLook } from './look';
import { LaunchArt } from './launch-art';

export function ContentLoader({ inline = false }: { inline?: boolean }) {
  const look = useLook();
  const { viewport } = useHost();
  const [visible, show] = useState(false);
  useEffect(() => { const timer = setTimeout(() => show(true), 250); return () => clearTimeout(timer); }, []);
  return <View testID={inline ? 'vela-inline-loader' : 'vela-content-loader'} pointerEvents="none" accessible={visible}
    accessibilityRole="progressbar" accessibilityLabel={msg('ui.findingTitles')}
    style={{ minHeight: inline ? 48 : Math.max(220, viewport.height - 240), width: '100%', alignItems: 'center', justifyContent: 'center' }}>
    {visible && <Animated.View style={look.still ? { animationName: { from: { opacity: 0.65 }, to: { opacity: 0.9 } }, animationDuration: 1600, animationIterationCount: 'infinite', animationDirection: 'alternate' } : undefined}>
      <LaunchArt width={inline ? 76 : 200} height={inline ? 76 : 200} still={look.still} compact ink={look.ui.ink} accent={look.ui.accent} />
    </Animated.View>}
  </View>;
}
export function LoadingWidget({ params }: WidgetProps) { return <ContentLoader inline={params?.inline === 'true'} />; }
