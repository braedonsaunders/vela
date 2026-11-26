import { useCallback, useMemo, useState } from 'react';
import type { SkinHost } from '@vela/skin';
import { useLibraryPage } from './library-page';
import { queryOf, type LibraryParams } from './library-query';
import { libraryHostBuilder } from './page-host';

/** Shared library view model and actions for experiences using the library scenes. */
export function useLibraryRoutePage(id: string, params: LibraryParams) {
  const { sort, dir, kind, genre, year, played, fav, collectionId, query: search, facets, start } = params;
  const query = useMemo(
    () => queryOf({ sort, dir, kind, genre, year, played, fav, collectionId, query: search, facets, start }),
    [sort, dir, kind, genre, year, played, fav, collectionId, search, facets, start],
  );
  const library = useLibraryPage(id, query, params.view, params.facetTitle);
  const [build] = useState(libraryHostBuilder);
  return useCallback((host: SkinHost) => build(host, id, query, library), [build, id, query, library]);
}
