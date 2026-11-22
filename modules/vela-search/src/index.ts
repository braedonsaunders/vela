import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';

export * from './model';

export interface NativeSearchProps extends ViewProps {
  placeholder?: string;
  /** Off while covered (a title page over search): the field and results take no focus. */
  active?: boolean;
  /** Bumped to move focus into the results (Return found something). */
  focusResults?: number;
  onChangeText?(event: NativeSyntheticEvent<{ text: string }>): void;
  /** Return (or focus leaving the keyboard): `focused` when focus already moved into the results. */
  onSubmit?(event: NativeSyntheticEvent<{ text: string; focused: boolean }>): void;
  /** The results area under the system's field and keyboard; the children are laid out in it. */
  onResultsLayout?(event: NativeSyntheticEvent<{ x: number; y: number; width: number; height: number }>): void;
}

/** The system search screen on Apple TV; elsewhere search keeps the skin's own field. */
export const NativeSearchView: ComponentType<NativeSearchProps> | undefined = Platform.OS === 'ios' && Platform.isTV
  ? requireNativeViewManager<NativeSearchProps>('VelaSearch') : undefined;
