// Live TV multiview: up to four live channels on one screen (packages/skin/src/widgets/multiview).
// `?add=<channelId>` adds a channel on arrival; `?channels=a,b,c&layout=grid&focus=1` sets the
// whole screen (a deep link, and how a device check opens a known screen).
import { router, useIsFocused, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { VelaPlayerView } from '@vela/player';
import { HostContext } from '@vela/skin/src/host';
import { useLiveSurface, useLiveView } from '@vela/skin/src/widgets/guide';
import { MultiviewScreen, useMultiview, type MultiviewLayout } from '@vela/skin/src/widgets/multiview';
import { backFromNavigation, useBackHeld } from '@vela/skin/src/widgets/player';
import { useVela } from '../src/vela';

const LAYOUTS: MultiviewLayout[] = ['split', 'grid', 'feature'];

export default function Multiview() {
  const { add, channels: listed, layout, focus } = useLocalSearchParams<{ add?: string; channels?: string; layout?: string; focus?: string }>();
  const { host } = useVela();
  const multiview = useMultiview();
  const focused = useIsFocused();
  const live = useLiveView();
  useLiveSurface('multiview', focused);
  usePreventRemove(useBackHeld(), backFromNavigation);

  const applied = useRef('');
  useEffect(() => {
    const controller = multiview?.controller;
    const key = `${add ?? ''}|${listed ?? ''}|${layout ?? ''}|${focus ?? ''}`;
    if (!controller || applied.current === key) return;
    applied.current = key;
    if (listed) {
      const wanted = listed.split(',').filter(Boolean).slice(0, 4);
      for (const tile of controller.view().tiles) if (!wanted.includes(tile.channelId)) controller.remove(tile.slot);
      for (const id of wanted) controller.add(id);
    }
    if (add) controller.add(add);
    if (layout && LAYOUTS.includes(layout as MultiviewLayout)) controller.setLayout(layout as MultiviewLayout);
    const tile = focus !== undefined ? controller.view().tiles[Number(focus)] : undefined;
    if (tile) controller.focus(tile.slot);
  }, [multiview, add, listed, layout, focus]);

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  const skin = host('watch', 'multiview');
  if (!multiview || !skin) return <View style={styles.stage} />;
  return (
    <HostContext.Provider value={skin}>
      <View style={styles.stage}>
        <MultiviewScreen controller={multiview.controller} Player={VelaPlayerView} channels={live.guide?.channels ?? []} onLeave={leave} />
      </View>
    </HostContext.Provider>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000' },
});
