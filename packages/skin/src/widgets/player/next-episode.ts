// The episode after the one playing, for the player's Next episode: read once per episode from the
// server's own title details (core's Playback.nextEpisode), whatever kind of server it is.
import { useEffect, useState } from 'react';
import { msg, type Card } from '@vela/core';
import { useVela } from '@vela/core/react';
import type { Title } from '../../../../protocol/types';

/** The next episode of `title` when it is a video episode with one; null until known, or when none. */
export function useNextEpisode(title: Card | undefined): Title | null {
  const vela = useVela();
  const [found, setFound] = useState<{ of: string; next: Title | null } | null>(null);
  const episode = title && title.kind === 'episode' && !title.media && title.showId ? title : undefined;
  const id = episode?.id ?? '', showId = episode?.showId ?? '', seasonId = episode?.seasonId ?? '', seasonNumber = episode?.seasonNumber;
  useEffect(() => {
    if (!id) return;
    let current = true;
    vela.playback.nextEpisode({ id, showId, ...(seasonId ? { seasonId } : {}), ...(seasonNumber !== undefined ? { seasonNumber } : {}) })
      .then(next => { if (current) setFound({ of: id, next }); }, () => { if (current) setFound({ of: id, next: null }); });
    return () => { current = false; };
  }, [vela, id, showId, seasonId, seasonNumber]);
  return found && found.of === id ? found.next : null;
}

/** An episode's name as the player offers it: "S1 · E3 · Name", or the name. */
export function episodeLabel(episode: Title): string {
  return episode.seasonNumber && episode.episodeNumber
    ? msg('ui.sSeasonEEpisodeTitle', { season: episode.seasonNumber, episode: episode.episodeNumber, title: episode.name })
    : episode.name;
}
