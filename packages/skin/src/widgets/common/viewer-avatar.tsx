// The viewer's picture over their badge's initial. It is decorative (the profile control already
// names the viewer), and one that fails to load leaves the initial showing through.
import { useState } from 'react';
import { Image } from 'expo-image';
import { Platform, StyleSheet } from 'react-native';
import { useHost } from '../../host';

const web = Platform.OS === 'web';

export function ViewerAvatar({ src }: { src: string }) {
  const host = useHost();
  const [failed, setFailed] = useState('');
  const source = host.image(src);
  if (!source || failed === src) return null;
  return (
    <Image
      source={source}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={240}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...(web ? { 'aria-hidden': true } : {})}
      onError={() => setFailed(src)}
    />
  );
}
