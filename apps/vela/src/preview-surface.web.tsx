// One cross-platform fade driven by decoded playback, never by grant availability.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { VelaPlayerView } from '@vela/player';
import type { Snapshot } from '@vela/player-api';

const NO_EXPIRY = '9999-12-31T00:00:00.000Z';
export function PreviewSurface({ url }: { url: string }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const visible = useRef(false);
  const preview = useMemo(() => ({ url, mimeType: 'video/mp4', expiresAt: NO_EXPIRY, loop: false, startSeconds: 10 }), [url]);
  const show = useCallback((playing: boolean) => {
    if (visible.current === playing) return;
    visible.current = playing;
    Animated.timing(opacity, { toValue: playing ? 1 : 0, duration: playing ? 450 : 250, useNativeDriver: true }).start();
  }, [opacity]);
  useEffect(() => { visible.current = false; opacity.setValue(0); }, [url, opacity]);
  const snapshot = useCallback((value: Snapshot) => show(value.state === 'playing' && !value.waiting), [show]);
  return <Animated.View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="none">
    <VelaPlayerView preview={preview} style={StyleSheet.absoluteFill} onSnapshot={snapshot} onError={() => show(false)} />
  </Animated.View>;
}
