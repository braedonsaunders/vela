// The `visualizer` rich block: the shipped music visualizer (apps/vela/src/visualizer, scenes in
// packages/visualizer), re-hosted as a document block. The app owns the stage (renderers, audio
// analysis, the per-profile On/Off and scene) and hands it in through VisualizerHostContext, so the
// skin package draws it without importing the app. Props: mode (background | fullscreen) and
// sceneId; parts visualizer.scenePicker, sceneChip, sceneChipActive and caption. Where no stage is
// offered (no host, or a device that cannot draw one: env.canVisualize) the block draws its
// fallback node instead.
import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { useHost } from '../../host';
import { usePart } from './look';

/** Resolved styles for the visualizer's parts, read by the app's stage and scene picker. */
export interface VisualizerParts {
  'visualizer.scenePicker'?: StyleProp<ViewStyle>;
  'visualizer.sceneChip'?: StyleProp<ViewStyle>;
  'visualizer.sceneChipActive'?: StyleProp<ViewStyle>;
  'visualizer.caption'?: StyleProp<TextStyle>;
}
export const VisualizerPartsContext = createContext<VisualizerParts>({});

/** The visualizer's On/Off for this profile, offered where the device can draw one for this item. */
export interface VisualizerSwitch { on: boolean; onToggle(on: boolean): void }

/** What the app gives the visualizer block and Now Playing. */
export interface VisualizerHost {
  /** The stage: draws nothing while the viewer has it Off or nothing can be drawn. */
  Stage: ComponentType<{ mode: 'background' | 'fullscreen'; sceneId?: string }>;
  /** The Sound panel's On/Off switch while what plays could be visualized (else undefined). */
  useSwitch(): VisualizerSwitch | undefined;
}
export const VisualizerHostContext = createContext<VisualizerHost | null>(null);

export function useVisualizerHost(): VisualizerHost | null {
  return useContext(VisualizerHostContext);
}

export function VisualizerBlock({ mode, sceneId, fallback }: { mode: 'background' | 'fullscreen'; sceneId?: string; fallback?: ReactNode }) {
  const visualizer = useVisualizerHost();
  const host = useHost();
  const picker = usePart('visualizer.scenePicker').box;
  const chip = usePart('visualizer.sceneChip').box;
  const chipActive = usePart('visualizer.sceneChipActive').box;
  const caption = usePart('visualizer.caption').text;
  if (!visualizer || host.env.canVisualize === false) return <>{fallback ?? null}</>;
  const parts: VisualizerParts = { 'visualizer.scenePicker': picker, 'visualizer.sceneChip': chip, 'visualizer.sceneChipActive': chipActive, 'visualizer.caption': caption };
  const { Stage } = visualizer;
  return <VisualizerPartsContext.Provider value={parts}><Stage mode={mode} {...(sceneId ? { sceneId } : {})} /></VisualizerPartsContext.Provider>;
}
