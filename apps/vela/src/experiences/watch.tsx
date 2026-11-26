// Watch uses the active skin's library route and the shared library scenes.
import type { LibraryParams } from '../browse/library-query';
import { useLibraryRoutePage } from '../browse/library-route-page';
import { DocumentScreen } from '../screen';

export function WatchLibrary({ id, params }: { id: string; params: LibraryParams }) {
  const page = useLibraryRoutePage(id, params);
  return <DocumentScreen route="library" entry={id} page={page} sharedShell />;
}
