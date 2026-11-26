// The watch experience: films and TV, the active document's routes.library (the Vela base's when it
// draws none) over one library, its sort and filters held in the URL.
import { useCallback, useMemo, useState } from 'react';
import type { SkinHost } from '@vela/skin';
import { useLibraryPage } from '../browse/library-page';
import { queryOf, type LibraryParams } from '../browse/library-query';
import { libraryHostBuilder } from '../browse/page-host';
import { DocumentScreen } from '../screen';

export function WatchLibrary({ id, params }: { id: string; params: LibraryParams }) {
  const { sort, dir, kind, genre, year, played, fav, collectionId, query: search, facets, start } = params;
  const query = useMemo(
    () => queryOf({ sort, dir, kind, genre, year, played, fav, collectionId, query: search, facets, start }),
    [sort, dir, kind, genre, year, played, fav, collectionId, search, facets, start],
  );
  const library = useLibraryPage(id, query, params.view, params.facetTitle);
  const [build] = useState(libraryHostBuilder);
  const page = useCallback((host: SkinHost) => build(host, id, query, library), [build, id, query, library]);
  return <DocumentScreen route="library" entry={id} page={page} sharedShell />;
}
