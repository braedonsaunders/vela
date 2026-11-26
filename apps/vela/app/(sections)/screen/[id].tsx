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
import { previewDocUrl, previewToken } from '../../../src/screen-preview';

const PREVIEW_QUERY_KEYS = new Set(['screenPreview', 'previewDoc', 'previewFrame', 'tv']);

export default function PluginScreen() {
  const { id = '', ...rest } = useLocalSearchParams<{ id: string } & Record<string, string>>();
  const vela = useVela();
  const host = vela.host('screen', id);
  const active = useSectionFocus() ?? false;
  const entry = useVelaState(state => state.home.value?.screens.find(screen => screen.id === id));
  const previewing = Boolean(previewToken() || previewDocUrl());
  const page = entry?.page || 'index';
  const href = entry?.document.href || (previewing && id ? `/vela/v0/screens/${encodeURIComponent(id)}/pages/${encodeURIComponent(page)}/document` : '');
  // A Studio or `skin.ts serve` preview's query parameters belong to the preview address, not the page's.
  const params = useMemo(() => Object.fromEntries(Object.entries(rest).filter(([name, v]) => typeof v === 'string' && !PREVIEW_QUERY_KEYS.has(name))) as Record<string, string>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(rest)]);
  const back = useCallback(() => host?.dispatch('back', ''), [host]);
  const setParams = useCallback((next: Record<string, string>) => {
    router.setParams({ ...Object.fromEntries(Object.keys(params).map(name => [name, undefined])), ...next });
  }, [params]);
  const actions = useAppScreenActions({ host, back, setParams });
  if (!host || !id || !href) return <View style={{ flex: 1 }} />;
  return (
    <HostContext.Provider value={host}>
      <ScreenView target={{ kind: 'screen', id, page }} href={href} params={params} host={host} active={active} actions={actions} />
    </HostContext.Provider>
  );
}
