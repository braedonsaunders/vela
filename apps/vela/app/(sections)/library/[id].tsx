// A library page: the active document's routes.library (the Vela base's when it draws none) over
// one library, its sort and filters held in the URL (`?sort=&dir=&kind=&genre=&year=&played=&fav=`).
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo } from 'react';
import type { SkinHost } from '@vela/skin';
import { useLibraryPage } from '../../../src/browse/library-page';
import { queryOf, type LibraryParams } from '../../../src/browse/library-query';
import { libraryHost } from '../../../src/browse/page-host';
import { DocumentScreen } from '../../../src/screen';

export default function Library() {
  const params = useLocalSearchParams<LibraryParams & { id: string }>();
  return <LibrarySection id={params.id ?? ''} params={params} />;
}

/** A retained section has a stable identity independent of the navigator's route key. */
export function LibrarySection({ id, params }: { id: string; params: LibraryParams }) {
  const { sort, dir, kind, genre, year, played, fav, collectionId, query: search, facets } = params;
  const query = useMemo(
    () => queryOf({ sort, dir, kind, genre, year, played, fav, collectionId, query: search, facets }),
    [sort, dir, kind, genre, year, played, fav, collectionId, search, facets],
  );
  const library = useLibraryPage(id, query, params.view, params.facetTitle);
  const page = useCallback((host: SkinHost) => libraryHost(host, id, query, library), [id, query, library]);
  return <DocumentScreen route="library" entry={id} page={page} sharedShell />;
}
