// VelaEmbedView on iPhone, iPad and Android phones and tablets: a native web view (WKWebView, Android's
// WebView) that loads the host page under its own origin and only lets the player URL load inside it.
// TVs never embed, so the native view is not looked up there.
import { requireNativeViewManager } from 'expo-modules-core';
import { createElement, type ComponentType } from 'react';
import { Platform, View } from 'react-native';
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';
import type { VelaEmbedViewProps } from './types';

export type { VelaEmbedViewProps } from './types';

interface NativeProps {
  page: string;
  pageOrigin: string;
  frameUrl: string;
  onEmbedMessage(event: NativeSyntheticEvent<{ data: string }>): void;
  onEmbedFailure(event: NativeSyntheticEvent<{ reason: string }>): void;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Phones and tablets embed; TVs (tvOS has no web view) never do. */
export function canEmbed(): boolean {
  return !Platform.isTV && (Platform.OS === 'ios' || Platform.OS === 'android');
}

let native: ComponentType<NativeProps> | null = null;
function nativeView(): ComponentType<NativeProps> {
  native ??= requireNativeViewManager<NativeProps>('VelaEmbed');
  return native;
}

/** The player's origin and path: the only frame the host page may load. */
function frameOf(playerUrl: string): string {
  const url = new URL(playerUrl);
  return `${url.origin}${url.pathname}`;
}

export function VelaEmbedView({ playerUrl, page, pageOrigin, onMessage, onFailure, accessibilityLabel, testID, style }: VelaEmbedViewProps) {
  if (!canEmbed()) return <View style={style} testID={testID} />;
  return createElement(nativeView(), {
    page,
    pageOrigin,
    frameUrl: frameOf(playerUrl),
    onEmbedMessage: event => onMessage(event.nativeEvent.data),
    onEmbedFailure: event => onFailure(event.nativeEvent.reason),
    accessibilityLabel,
    testID,
    style,
  });
}
