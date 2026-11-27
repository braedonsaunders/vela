// Home's shared honest slow state: themed by the active skin, focusable on TV, and useful while
// the bootstrap continues in the background.
import { msg } from '@vela/core';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { FocusPressable } from '../../focus';
import { useHost, type WidgetProps } from '../../host';
import { useLook } from './look';

function Action({ label, onPress, preferred = false, testID }: { label: string; onPress(): void; preferred?: boolean; testID?: string }) {
  const look = useLook();
  const [focused, setFocused] = useState(false);
  return <FocusPressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
    hasTVPreferredFocus={preferred && Platform.isTV} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onPress}
    style={look.box({ height: '$ui.controlHeight', 'min-width': '112px', padding: '0px 18px', 'border-radius': '$ui.radiusControl',
      'background-color': focused ? '$ui.controlHover' : '$ui.control', border: `1px solid ${focused ? '$ui.accent' : '$ui.glassEdge'}`,
      'align-items': 'center', 'justify-content': 'center' })}>
    <Text numberOfLines={1} style={look.text({ 'font-size': '$ui.controlFontSize', 'font-weight': '600' })}>{label}</Text>
  </FocusPressable>;
}

export function HomeSlowWidget(_props: WidgetProps) {
  const host = useHost();
  const look = useLook();
  return <View testID="home-still-loading"
    style={[{ minHeight: Math.max(360, host.viewport.height - 160), width: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 72 },
      look.box({ 'background-color': '$ui.page' })]}>
    <View style={{ width: '100%', maxWidth: 720, alignItems: 'center', gap: 14 }}>
      <Text accessibilityRole="header" aria-level={1} accessibilityLiveRegion="polite"
        style={[look.text({ 'font-size': 'clamp(24px, 4vw, 38px)', 'font-weight': '700', 'line-height': '1.15', 'text-align': 'center' })]}>
        {msg('home.stillPreparing')}
      </Text>
      <Text style={look.text({ color: '$ui.inkSecondary', 'font-size': '17px', 'line-height': '1.5', 'text-align': 'center' })}>
        {msg('home.stillPreparingHint')}
      </Text>
      <View style={{ paddingTop: 8 }}><Action testID="home-retry" label={msg('home.retry')} preferred onPress={() => host.dispatch('retry', '')} /></View>
      {!!host.env.navigation.length && <>
        <Text style={look.text({ color: '$ui.inkSecondary', 'font-size': '15px', 'line-height': '1.4', 'text-align': 'center' })}>
          {msg('home.openLibraryInstead')}
        </Text>
        <View accessibilityRole={Platform.OS === 'web' ? 'navigation' as never : undefined} accessibilityLabel={msg('home.openLibraryInstead')}
          style={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
          {host.env.navigation.map(library => <Action key={library.id} testID={`home-library-${library.id}`} label={library.name}
            onPress={() => host.dispatch('library', library.id)} />)}
        </View>
      </>}
    </View>
  </View>;
}
