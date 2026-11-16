import { useIsFocused } from 'expo-router';
import { useLiveSurface } from '@vela/skin';
import { DocumentScreen } from '../../src/screen';
import { useVela } from '../../src/vela';

export default function Home() {
  const vela = useVela();
  const focused = useIsFocused();
  // A live home (`live.home`) holds the preview tile and listings only while home is the
  // visible route without a query.
  const query = vela.host('home', 'home')?.env.query ?? '';
  useLiveSurface('home', focused && !!vela.doc?.document.live?.home && query === '');
  return <DocumentScreen route="home" entry="home" sharedShell />;
}
