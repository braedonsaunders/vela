// VelaEmbedView: one embedded web player (a trailer in YouTube's privacy-enhanced embed) in a frame the
// app sized. The caller validates every URL it passes (packages/core/src/trailer-embed.ts); the view only
// loads that player and relays what the player posts. It never navigates anywhere else.
import type { StyleProp, ViewStyle } from 'react-native';

export interface VelaEmbedViewProps {
  /** The player URL: the iframe on the web, the one frame the native host page may load. */
  playerUrl: string;
  /** Posted to the player frame (to its origin) every 250 ms until it first answers (the web). */
  handshake: string;
  /** Native: the host page that frames the player, and the origin it loads under. */
  page: string;
  pageOrigin: string;
  /** A string message from the player frame. */
  onMessage(data: string): void;
  /** The view could not show the player (its page failed to load, or the web view process ended). */
  onFailure(reason: string): void;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}
