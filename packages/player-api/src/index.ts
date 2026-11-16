import type { StyleProp, ViewStyle } from 'react-native';
import type { VelaPlayerProps } from './types';

export * from './types';

/** React Native styling belongs to the view, not the browser media host. */
export interface VelaPlayerViewProps extends VelaPlayerProps {
  style?: StyleProp<ViewStyle>;
}
