// A collection page (a box set, a folder, a playlist): the active document's routes.collection,
// or the Vela base's when it draws none.
import { useLocalSearchParams } from 'expo-router';
import type { SkinHost } from '@vela/skin';
import { useCollectionPage } from '../../src/browse/collection-page';
import { collectionHost } from '../../src/browse/page-host';
import { DocumentScreen } from '../../src/screen';
import { PlaylistManager } from '../../src/playlists/playlist-manager';
import { View } from 'react-native';

export default function Collection() {
  const { id = '', playlist } = useLocalSearchParams<{ id: string; playlist?: string }>();
  const collection = useCollectionPage(id, playlist === '1');
  const page = (host: SkinHost) => collectionHost(host, collection);
  return <View style={{ flex: 1 }}><DocumentScreen route="collection" entry={id} page={page} />
    {playlist === '1' ? <PlaylistManager playlistId={id} /> : null}</View>;
}
