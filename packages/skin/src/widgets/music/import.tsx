// B7 Playlist import page wrapper around the self-contained `PlaylistImportBlock`
// (`packages/skin/src/blocks/import.tsx`).
import { useState } from 'react';
import { Text, View } from 'react-native';
import { msg } from '@vela/core';
import { useMediaLook } from '../media/parts';
import { ImportCover, PlaylistImportBlock, usePlaylistImport } from '../../blocks/import';
import { importSubtitle } from '../../blocks/import-copy';
import { useMusic } from './context';
import { coverSize, Header, Mosaic, pad } from './pages';
import { Wash } from './parts';

export { ImportCover };

export function MusicImport() {
  const app = useMusic();
  const m = useMediaLook();
  const { job, sources } = usePlaylistImport();
  const [playlistName, setPlaylistName] = useState('');
  const matchedCards = job?.matched.map(entry => entry.card) ?? [];

  return (
    <View testID="music-import-page">
      <Wash accent={matchedCards[0]?.accent || m.ui.accent} height={420} image={matchedCards[0]?.poster} />
      <View style={{ paddingHorizontal: pad(m), paddingBottom: 48 }}>
        <Header
          eyebrow={msg('music.import.eyebrow')}
          title={job ? (playlistName || job.name) : msg('music.import.title')}
          cover={job && matchedCards.length ? <Mosaic tracks={matchedCards} size={coverSize(m)} poster={job.poster} /> : <ImportCover size={coverSize(m)} />}>
          <Text style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary', 'max-width': '680px' })}>
            {job?.description || importSubtitle(sources)}
          </Text>
        </Header>

        <PlaylistImportBlock
          libraryId={app.libraryId || 'music'}
          onNameChange={setPlaylistName}
          onSaved={playlistId => app.go({ kind: 'playlist', id: playlistId })}
        />
      </View>
    </View>
  );
}
