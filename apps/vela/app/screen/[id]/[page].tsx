// A page of a plugin screen (the Sports game page), drawn from its document. Like a title page it
// opens over the page it came from: framed on desktop, web and tablets, the whole screen on a TV and
// a phone. Back, Menu and Escape close it; on the web so does a click on the dimmed page around it.
import { Redirect, useFocusEffect, useIsFocused, useLocalSearchParams } from 'expo-router';
import { router } from '../../../src/router';
import { useCallback, useMemo } from 'react';
import { BackHandler, Platform, View } from 'react-native';
import { screenDocumentHref } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { ScreenActive } from '@vela/skin';
import { HostContext } from '@vela/skin/src/host';
import { holdBack } from '@vela/skin/src/menu-key';
import { ScreenView } from '@vela/skin/src/screen/host';
import { useVela } from '../../../src/vela';
import { closeModal } from '../../../src/modal-motion';
import { PageFrame } from '../../../src/page-frame';
import { useAppScreenActions } from '../../../src/screen-actions';
import { previewDocUrl, previewToken } from '../../../src/screen-preview';
import { screenLandingHref } from '../../../src/plugin-screens';

const PREVIEW_QUERY_KEYS = new Set(['screenPreview', 'previewDoc', 'previewFrame', 'tv']);

export default function ScreenPage() {
  const { id = '', page = '', ...rest } = useLocalSearchParams<{ id: string; page: string } & Record<string, string>>();
  const vela = useVela();
  const host = vela.host('screen', id);
  const focused = useIsFocused();
  const entry = useVelaState(state => state.home.value?.screens.find(screen => screen.id === id));
  const previewing = Boolean(previewToken() || previewDocUrl());
  const href = entry
    ? screenDocumentHref(entry.document.href, page)
    : previewing && id && page
      ? `/vela/v0/screens/${encodeURIComponent(id)}/pages/${encodeURIComponent(page)}/document`
      : '';
  // A Studio or `skin.ts serve` preview's query parameters belong to the preview address, not the page's.
  const params = useMemo(() => Object.fromEntries(Object.entries(rest).filter(([name, v]) => typeof v === 'string' && !PREVIEW_QUERY_KEYS.has(name))) as Record<string, string>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(rest)]);
  const landing = screenLandingHref(entry, page, rest);
  const back = useCallback(() => closeModal(() => {
    if (router.canGoBack()) router.back();
    else if (entry) router.replace({ pathname: '/screen/[id]', params: { id: entry.id } });
    else router.replace('/');
  }), [entry]);
  const setParams = useCallback((next: Record<string, string>) => {
    router.setParams({ ...Object.fromEntries(Object.keys(params).map(name => [name, undefined])), ...next });
  }, [params]);
  const actions = useAppScreenActions({ host, back, setParams });
  useFocusEffect(useCallback(() => {
    if (landing) return;
    if (Platform.isTV && Platform.OS === 'ios') return holdBack(() => { back(); return true; }, { fallback: true });
    if (Platform.OS !== 'web') {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
      return () => subscription.remove();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, !!landing]));
  if (landing) return <Redirect href={landing} />;
  if (!host || !id || !page || !href) return <View style={{ flex: 1 }} />;
  return (
    <ScreenActive.Provider value={focused}>
      <HostContext.Provider value={host}>
        <PageFrame host={host} close={back} active={focused}>
          <ScreenView target={{ kind: 'screen', id, page }} href={href} params={params} host={host} active={focused} actions={actions} />
        </PageFrame>
      </HostContext.Provider>
    </ScreenActive.Provider>
  );
}
