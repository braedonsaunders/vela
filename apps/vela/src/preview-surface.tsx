// A trailer preview natively (Apple TV, iOS, Android): the player view's preview mode, a muted loop in
// the view's box that plays only on screen and before the grant expires, and releases its decoder otherwise.
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { VelaPlayerView } from '@vela/player';

/** The grant's URL is all the surface is given; its expiry is enforced by core, which unsets it. */
const NO_EXPIRY = '9999-12-31T00:00:00.000Z';

export function PreviewSurface({ url }: { url: string }) {
  const preview = useMemo(() => ({ url, mimeType: 'video/mp4', expiresAt: NO_EXPIRY, loop: true }), [url]);
  return <VelaPlayerView preview={preview} style={StyleSheet.absoluteFill} />;
}
