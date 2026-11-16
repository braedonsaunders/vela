// A library page: the active document's routes.library (the Vela base's when it draws none) over
// one library, its sort and filters held in the URL (`?sort=&dir=&kind=&genre=&year=&played=&fav=`).
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import type { SkinHost } from '@vela/skin';
import { useLibraryPage } from '../../../src/browse/library-page';
import { queryOf, type LibraryParams } from '../../../src/browse/library-query';
import { libraryHost } from '../../../src/browse/page-host';
import { DocumentScreen } from '../../../src/screen';

export default function Library() {
  const params = useLocalSearchParams<LibraryParams & { id: string }>();
  const id = params.id ?? '';
  const { sort, dir, kind, genre, year, played, fav } = params;
  const query = useMemo(
    () => queryOf({ sort, dir, kind, genre, year, played, fav }),
    [sort, dir, kind, genre, year, played, fav],
  );
  const library = useLibraryPage(id, query);
  const page = (host: SkinHost) => libraryHost(host, id, query, library);
  return <DocumentScreen route="library" entry={id} page={page} sharedShell />;
}
