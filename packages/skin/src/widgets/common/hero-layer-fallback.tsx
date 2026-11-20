import { Image, type ImageSource } from 'expo-image';
import { StyleSheet } from 'react-native';

export interface HeroLayerProps {
  source: ImageSource | number | undefined;
  blurred?: boolean;
  onError(): void;
  onLoad(): void;
}

export function ExpoHeroLayer({ source, blurred, onError, onLoad }: HeroLayerProps) {
  return <Image source={source} contentFit="cover" blurRadius={blurred ? 55 : undefined}
    style={[StyleSheet.absoluteFill, blurred && { transform: [{ scale: 1.15 }] }]} onError={onError} onLoad={onLoad} />;
}

