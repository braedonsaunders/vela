// One route drawn by the active document: the shell's tree around the route's tree. A document
// that fails to resolve says so; nothing half-draws. A route with a page model of its own (a
// library, a collection) adds it to the host with `page`.
import { useIsFocused } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { ScreenActive, SkinRoot, SkinRoute, focusElement, useReturnFocus, type RouteName, type SkinHost } from '@vela/skin';
import { useVela } from './vela';
import { useSectionFocus } from './section-focus';

interface Props {
  route: RouteName;
  entry: string;
  page?: (host: SkinHost) => SkinHost;
  sharedShell?: boolean;
}

export function DocumentScreen({ route, entry, page, sharedShell = false }: Props) {
  const vela = useVela();
  const app = vela.host(route, entry);
  const host = app && page ? page(app) : app;
  const season = route === 'title' ? host?.env.season : '';
  useEffect(() => {
    if (season) void vela.store.catalogue.title(season);
  }, [season, vela.store]);
  // On TV, focus returns to the card or button that opened the route above when it closes.
  const navigationFocused = useIsFocused();
  const sectionFocused = useSectionFocus();
  useReturnFocus(sectionFocused ?? navigationFocused);
  const isCurrent = sectionFocused ?? navigationFocused;
  const focusSearch = !!host?.env.flags.includes('focus-search-on-home');
  const setFlag = host?.setFlag;
  useEffect(() => {
    if (route !== 'home' || !isCurrent || !focusSearch || !setFlag) return;
    let frame = 0, attempts = 0;
    const focus = () => {
      if (focusElement('vela-search')) setFlag('focus-search-on-home', false);
      else if (++attempts < 120) frame = requestAnimationFrame(focus);
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [route, isCurrent, focusSearch, setFlag]);
  if (vela.docError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ color: '#f5f1e9', fontSize: 18 }}>{vela.docError}</Text>
      </View>
    );
  }
  const tree = vela.doc?.routes[route];
  if (!host || !tree) return <View style={{ flex: 1 }} />;
  // Search draws in home's view, after home's nodes, while a query is open (docs/skin-schema.md).
  const search = route === 'home' && host.env.query !== '' ? vela.doc?.routes.search : undefined;
  const content = <SkinRoute host={host} node={tree} after={search} />;
  const shell = route === 'title' || sharedShell ? undefined : vela.doc?.shell;
  // The transparent navigator modal fills the viewport, including the section shell's header.
  // Keep the scrim outside the skin's scrolling/frame geometry on web and native hosts alike.
  if (route === 'title') return (
    <ScreenActive.Provider value={isCurrent}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.75)' }} accessibilityViewIsModal>
        {content}
      </View>
    </ScreenActive.Provider>
  );
  return (
    <ScreenActive.Provider value={isCurrent}>
      {shell ? <SkinRoot host={{ ...host, children: content }} node={shell} /> : content}
    </ScreenActive.Provider>
  );
}
