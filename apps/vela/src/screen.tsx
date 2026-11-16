// One route drawn by the active document: the shell's tree around the route's tree. A document
// that fails to resolve says so; nothing half-draws. A route with a page model of its own (a
// library, a collection) adds it to the host with `page`.
import { useIsFocused } from 'expo-router';
import { Text, View } from 'react-native';
import { SkinRoot, SkinRoute, useReturnFocus, type RouteName, type SkinHost } from '@vela/skin';
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
  // On TV, focus returns to the card or button that opened the route above when it closes.
  const navigationFocused = useIsFocused();
  const sectionFocused = useSectionFocus();
  useReturnFocus(sectionFocused ?? navigationFocused);
  if (vela.docError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ color: '#f5f1e9', fontSize: 18 }}>{vela.docError}</Text>
      </View>
    );
  }
  const tree = vela.doc?.routes[route];
  if (!host || !tree) return <View style={{ flex: 1 }} />;
  // Search draws in home's view, after home's nodes, while a query is open (docs/skin-schema.md, "Search").
  const search = route === 'home' && host.env.query !== '' ? vela.doc?.routes.search : undefined;
  const content = <SkinRoute host={host} node={tree} after={search} />;
  const shell = route === 'title' || sharedShell ? undefined : vela.doc?.shell;
  return shell ? <SkinRoot host={{ ...host, children: content }} node={shell} /> : content;
}
