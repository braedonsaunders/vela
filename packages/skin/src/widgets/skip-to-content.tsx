import { useState } from 'react';
import { Platform, Pressable, Text, type ViewStyle } from 'react-native';

export function SkipToContent({ target }: { target: string }) {
  const [focused, setFocused] = useState(false);
  if (Platform.OS !== 'web') return null;
  return (
    <Pressable accessibilityRole="link" {...{ href: `#${target}` }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={{
        position: 'fixed', left: 12, top: focused ? 8 : -80, zIndex: 10000, paddingVertical: 10,
        paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#161616',
      } as unknown as ViewStyle}>
      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Skip to content</Text>
    </Pressable>
  );
}
