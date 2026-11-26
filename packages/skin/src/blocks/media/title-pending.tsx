import { Text, View } from 'react-native';
import { msg, type DetailModel, type Loadable } from '@vela/core';
import { useVela } from '@vela/core/react';
import { PillButton, useMediaLook, type MediaLook } from './parts';

export function MediaTitlePending({ load, id }: { load: Loadable<DetailModel>; id: string }) {
  const m = useMediaLook();
  const store = useVela();
  if (load.load === 'failed') return (
    <View style={{ paddingVertical: 80, gap: 18, alignItems: 'flex-start' }} accessibilityRole="alert">
      <Text style={m.text({ 'font-size': '18px' })}>{msg('media.ui.loadFailed')}</Text>
      <PillButton label={msg('media.ui.retry')} onPress={() => void store.catalogue.title(id, true)} />
    </View>
  );
  const size = heroCover(m);
  return (
    <View style={{ flexDirection: m.small ? 'column' : 'row', gap: 32, opacity: 0.7 }} accessibilityLabel="Loading" accessibilityRole="progressbar">
      <View style={{ width: size, height: size, borderRadius: 10, backgroundColor: m.ui.skeleton }} />
      <View style={{ flex: 1, gap: 14, justifyContent: 'flex-end' }}>
        {[0.2, 0.6, 0.35].map((w, i) => <View key={i} style={{ width: `${w * 100}%`, height: i === 1 ? 44 : 14, borderRadius: 8, backgroundColor: m.ui.skeletonLight }} />)}
      </View>
    </View>
  );
}

export function heroCover(m: MediaLook): number {
  return m.small ? Math.min(300, m.width - m.gutter * 2 - 40) : m.wide ? 320 : 260;
}
