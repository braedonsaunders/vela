// B8b Duplicate review page wrapper around the self-contained `DuplicatesBlock`
// (`packages/skin/src/blocks/duplicates.tsx`).
import { Text, View } from 'react-native';
import { msg, number, plural } from '@vela/core';
import { useMediaLook } from '../media/parts';
import { DuplicatesBlock, DuplicatesCover, useLibraryDuplicates } from '../../blocks/duplicates';
import { useMusic } from '../../blocks/listen/app';
import { coverSize, Header, pad } from '../../blocks/listen/pages';
import { Wash } from '../../blocks/listen/parts';

export { DuplicatesCover };

export function MusicDuplicates() {
  const app = useMusic();
  const m = useMediaLook();
  const libraryId = app.libraryId || 'music';
  const { groups } = useLibraryDuplicates(libraryId);
  const firstCard = groups[0]?.cards[0];

  return (
    <View testID="music-duplicates-page">
      <Wash accent={firstCard?.accent || m.ui.accent} height={420} image={firstCard?.poster} />
      <View style={{ paddingHorizontal: pad(m), paddingBottom: 48 }}>
        <Header eyebrow={msg('music.duplicates.eyebrow')} title={msg('music.duplicates.title')} cover={<DuplicatesCover size={coverSize(m)} />}>
          <Text style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary', 'max-width': '680px' })}>
            {msg('music.duplicates.subtitle')}
          </Text>
          {groups.length ? (
            <Text style={m.text({ 'font-size': '14px', 'font-weight': '700', color: '$ui.ink' })}>
              {msg(`music.duplicates.groupCount.${plural(groups.length)}`, { count: number(groups.length) })}
            </Text>
          ) : null}
        </Header>

        <DuplicatesBlock
          libraryId={libraryId}
          onPlayRelease={(release, source) => app.play([release], 0, source)}
          onOpenAlbum={albumId => app.go({ kind: 'title', id: albumId })}
        />
      </View>
    </View>
  );
}
