import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { DocumentScreen } from '../src/screen';
import { useVela } from '../src/vela';

/** Shareable web search route. Search still draws with home's document and shell. */
export default function Search() {
  const vela = useVela();
  const params = useLocalSearchParams<{ q?: string | string[] }>();
  const query = Array.isArray(params.q) ? params.q[0] ?? '' : params.q ?? '';
  useEffect(() => {
    if (vela.store.getState().search.query !== query) vela.store.search.setQuery(query);
  }, [query, vela.store]);
  useFocusEffect(useCallback(() => () => vela.store.search.clear(), [vela.store]));
  return <DocumentScreen route="home" entry="home" />;
}
