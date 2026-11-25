import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { StageProps } from './stage-types';

interface VisualizerModule {
  canVisualize(): boolean;
  canOpenVisualizer?(): boolean;
  addListener?(name: 'onAvailabilityChange', changed: () => void): { remove(): void };
}
const native = requireOptionalNativeModule<VisualizerModule>('VelaVisualizer');
const NativeStage = native ? requireNativeViewManager<StageProps & { style: StyleProp<ViewStyle> }>('VelaVisualizer') : null;
export function canVisualize(): boolean {
  try { return !!native?.canVisualize(); } catch { return false; }
}
export function canOpenVisualizer(): boolean {
  try { return native?.canOpenVisualizer?.() ?? canVisualize(); } catch { return false; }
}

export function subscribeVisualizerAvailability(update: () => void) {
  const listener = native?.addListener?.('onAvailabilityChange', update);
  return () => listener?.remove();
}

export function VisualizerStage(props: StageProps) {
  return NativeStage ? <NativeStage {...props} style={StyleSheet.absoluteFill} /> : null;
}
