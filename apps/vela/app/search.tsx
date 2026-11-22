import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { AppleTvSearch, appleTvSearch } from '../src/apple-tv-search';
import { DocumentScreen } from '../src/screen';
import { useVela } from '../src/vela';

/** Shareable web search route; on Apple TV, the system search screen (apple-tv-search.tsx). */
export default function Search() {
  return appleTvSearch ? <AppleTvSearch /> : <SharedSearch />;
}

/** Search still draws with home's document and shell. */
function SharedSearch() {
  const vela = useVela();
  const params = useLocalSearchParams<{ q?: string | string[] }>();
  const query = Array.isArray(params.q) ? params.q[0] ?? '' : params.q ?? '';
  useEffect(() => {
    if (vela.store.getState().search.query !== query) vela.store.search.setQuery(query);
  }, [query, vela.store]);
  useFocusEffect(useCallback(() => () => vela.store.search.clear(), [vela.store]));
  return <DocumentScreen route="home" entry="home" />;
}
