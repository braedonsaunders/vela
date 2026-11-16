// One route drawn by the active document: the shell's tree around the route's tree. A document
// that fails to resolve says so; nothing half-draws.
import { Text, View } from 'react-native';
import { SkinRoot, SkinRoute } from '@vela/skin';
import { useVela } from './vela';

export function DocumentScreen({ route, entry }: { route: 'home' | 'title'; entry: string }) {
  const vela = useVela();
  const host = vela.host(route, entry);
  if (vela.docError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ color: '#f5f1e9', fontSize: 18 }}>{vela.docError}</Text>
      </View>
    );
  }
  const tree = vela.doc?.routes[route];
  if (!host || !tree) return <View style={{ flex: 1 }} />;
  const content = <SkinRoute host={host} node={tree} />;
  const shell = vela.doc?.shell;
  return shell ? <SkinRoot host={{ ...host, children: content }} node={shell} /> : content;
}
