// A plugin screen (Sports) as a top-level section: drawn natively inside the active document's
// shell, live while it is the section on show. With screen documents on (development flag,
// screens-flag.ts) it draws the screen's document from bootstrap navigation; otherwise the
// hard-coded Sports screen (removed with the flag, hard cut).
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { useVelaState } from '@vela/core/react';
import { HostContext } from '@vela/skin/src/host';
import { ScreenView } from '@vela/skin/src/screen/host';
import { SportsActionsContext, SportsScreen } from '@vela/skin/src/widgets/sports';
import { useVela } from '../../../src/vela';
import { useSectionFocus } from '../../../src/section-focus';
import { useAppSportsActions } from '../../../src/sports/actions';
import { useAppScreenActions } from '../../../src/screen-actions';
import { screenDocuments } from '../../../src/screens-flag';

export default function PluginScreen() {
  return screenDocuments() ? <DocumentScreen /> : <LegacyScreen />;
}

function DocumentScreen() {
  const { id = '', ...rest } = useLocalSearchParams<{ id: string } & Record<string, string>>();
  const vela = useVela();
  const host = vela.host('screen', id);
  const active = useSectionFocus() ?? false;
  const entry = useVelaState(state => state.home.value?.screens.find(screen => screen.id === id));
  const params = useMemo(() => Object.fromEntries(Object.entries(rest).filter(([name, v]) => typeof v === 'string' && name !== 'screens')) as Record<string, string>,
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

function LegacyScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const vela = useVela();
  const host = vela.host('screen', id);
  const active = useSectionFocus() ?? false;
  const actions = useAppSportsActions();
  if (!host || !id) return <View style={{ flex: 1 }} />;
  return (
    <HostContext.Provider value={host}>
      <SportsActionsContext.Provider value={actions}>
        <SportsScreen id={id} active={active} />
      </SportsActionsContext.Provider>
    </HostContext.Provider>
  );
}
