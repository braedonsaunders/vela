// B6 Listening recap ("Rewind") page wrapper around the self-contained `RecapBlock`
// (`packages/skin/src/blocks/recap.tsx`).
import { useState } from 'react';
import { Text, View } from 'react-native';
import { formatFirstPlayLabel, msg, type HistoryRecapPeriod } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { useMediaLook } from '../media/parts';
import { RecapBlock, RewindCover, useHistoryRecap } from '../../blocks/recap';
import { placeOf, useMusic } from './context';
import { coverSize, Header, pad } from './pages';
import { Wash } from './parts';

export { RewindCover };

export function MusicRewind() {
  const app = useMusic();
  const m = useMediaLook();
  const [period, setPeriod] = useState<HistoryRecapPeriod>('month');
  const { recap } = useHistoryRecap(period, app.libraryId);
  const viewer = useVelaState(s => s.auth.viewer) || 'Viewer';
  const topArtist = recap?.topArtists[0]?.card;
  const topTrack = recap?.topTracks[0]?.card;
  const accent = topArtist?.accent || topTrack?.accent || m.ui.accent;
  const firstPlayLabel = formatFirstPlayLabel(recap?.firstPlayAt);

  return (
    <View testID="music-rewind-page">
      <Wash accent={accent} height={460} image={topArtist?.poster || topTrack?.poster} />
      <View style={{ paddingHorizontal: pad(m), paddingBottom: 48 }}>
        <Header eyebrow={msg('music.rewind.eyebrow')} title={msg('music.rewind.title')} cover={<RewindCover size={coverSize(m)} />}>
          <Text style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary' })}>
            <Text style={m.text({ 'font-weight': '700', color: '$ui.ink' })}>{viewer}</Text>
            {' · '}{msg('music.rewind.subtitle', { period: msg(`music.rewind.period.${period}`).toLowerCase() })}
            {firstPlayLabel ? ` · ${firstPlayLabel}` : ''}
          </Text>
        </Header>

        <RecapBlock
          libraryId={app.libraryId}
          listening={app.listening === 'audiobook' || app.listening === 'podcast' ? app.listening : 'music'}
          period={period}
          onPeriodChange={setPeriod}
          onSelectCard={card => app.go(placeOf(card))}
          onPlayCards={(cards, idx) => app.play(cards, idx, { id: 'rewind', name: msg('music.rewind.title') })}
        />
      </View>
    </View>
  );
}
