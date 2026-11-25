import { createContext } from 'react';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

/** The host can supply resolved skin styles without changing the block's two props. */
export interface VisualizerParts {
  'visualizer.scenePicker'?: StyleProp<ViewStyle>;
  'visualizer.sceneChip'?: StyleProp<ViewStyle>;
  'visualizer.sceneChipActive'?: StyleProp<ViewStyle>;
  'visualizer.caption'?: StyleProp<TextStyle>;
}
export const VisualizerPartsContext = createContext<VisualizerParts>({});
