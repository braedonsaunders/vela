// A collection page (a box set, a folder, a playlist): the active document's routes.collection,
// or the Vela base's when it draws none.
import { useLocalSearchParams } from 'expo-router';
import type { SkinHost } from '@vela/skin';
import { useCollectionPage } from '../../src/browse/collection-page';
import { collectionHost } from '../../src/browse/page-host';
import { DocumentScreen } from '../../src/screen';

export default function Collection() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const collection = useCollectionPage(id);
  const page = (host: SkinHost) => collectionHost(host, collection);
  return <DocumentScreen route="collection" entry={id} page={page} />;
}
