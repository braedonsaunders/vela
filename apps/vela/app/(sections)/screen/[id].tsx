// A plugin screen as a top-level section (docs/plugin-screens.md): its landing page's document from
// bootstrap navigation, drawn natively inside the active document's shell, live while it is the
// section on show.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { useVelaState } from '@vela/core/react';
import { HostContext } from '@vela/skin/src/host';
import { ScreenView } from '@vela/skin/src/screen/host';
import { useVela } from '../../../src/vela';
import { useSectionFocus } from '../../../src/section-focus';
import { useAppScreenActions } from '../../../src/screen-actions';

export default function PluginScreen() {
  const { id = '', ...rest } = useLocalSearchParams<{ id: string } & Record<string, string>>();
  const vela = useVela();
  const host = vela.host('screen', id);
  const active = useSectionFocus() ?? false;
  const entry = useVelaState(state => state.home.value?.screens.find(screen => screen.id === id));
  // A Studio preview's token is the address's, not the page's.
  const params = useMemo(() => Object.fromEntries(Object.entries(rest).filter(([name, v]) => typeof v === 'string' && name !== 'screenPreview')) as Record<string, string>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(rest)]);
  const back = useCallback(() => host?.dispatch('back', ''), [host]);
  const setParams = useCallback((next: Record<string, string>) => {
    router.setParams({ ...Object.fromEntries(Object.keys(params).map(name => [name, undefined])), ...next });
  }, [params]);
  const actions = useAppScreenActions({ host, back, setParams });
  if (!host || !id || !entry) return <View style={{ flex: 1 }} />;
  return (
    <HostContext.Provider value={host}>
      <ScreenView target={{ kind: 'screen', id, page: entry.page || 'index' }} href={entry.document.href} params={params} host={host} active={active} actions={actions} />
    </HostContext.Provider>
  );
}
