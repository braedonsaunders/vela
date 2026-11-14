import type { ArtworkRef, LiveSearchResults, Programme } from '../../wire/v0/types';
import { artworkURL } from '../discovery/artwork';
import { localeContext, msg, number, time } from '../../foundation/i18n';

function image(refs: ArtworkRef[], kinds: ArtworkRef['kind'][], origin: string, width: number, height: number): string {
  const ref = kinds.map(kind => refs.find(item => item.kind === kind)).find(Boolean);
  if (!ref) return '';
  try { return artworkURL(ref, width, height, origin) ?? ''; } catch { return ''; }
}
function dates(p: Programme) { return { start: Date.parse(p.start), end: Date.parse(p.end) }; }
function active(p: Programme, now: number) { const { start, end } = dates(p); return start <= now && now < end; }
function progress(p: Programme, now: number): number { const { start, end } = dates(p); return end > start && active(p, now) ? Math.max(0, Math.min(1, (now - start) / (end - start))) : 0; }

/** Project only facts returned by the fast lane, using the query's supplied time. */
export function liveSearch(data: LiveSearchResults | undefined, origin: string, now: number) {
  const channels = data?.channels ?? [], programmes = data?.programmes ?? [];
  const byId = new Map([...channels, ...(data?.programmeChannels ?? [])].map(channel => [channel.id, channel]));
  const startTime = new Intl.DateTimeFormat(localeContext().formatLocale, { timeZone: localeContext().timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return {
    liveChannels: channels.map(channel => {
      const current = programmes.find(p => p.channelId === channel.id && active(p, now));
      return { id: channel.id, name: channel.name, number: channel.number, logo: image(channel.artwork, ['channel', 'logo'], origin, 160, 90), nowTitle: current?.name ?? '', nowProgress: current ? progress(current, now) : 0, nowEndLabel: current ? time(Date.parse(current.end)) : '' };
    }),
    liveProgrammes: programmes.filter(p => { const { start, end } = dates(p); return Number.isFinite(start) && Number.isFinite(end) && end > now && end > start; }).map(p => {
      const channel = byId.get(p.channelId), { start, end } = dates(p), airing = active(p, now);
      const episode = [p.seasonNumber !== undefined && p.episodeNumber !== undefined ? msg('live.seasonEpisode', { season: number(p.seasonNumber), episode: number(p.episodeNumber) }) : '', p.episodeTitle ?? ''].filter(Boolean).join(' · ');
      return { id: p.id, channelId: p.channelId, channelName: channel?.name ?? '', channelLogo: channel ? image(channel.artwork, ['channel', 'logo'], origin, 160, 90) : '', name: p.name,
        startLabel: startTime.format(start), endLabel: time(end), airing, progress: progress(p, now), startsInLabel: airing ? '' : msg('live.startsIn', { minutes: number(Math.max(0, Math.ceil((start - now) / 60000))) }),
        episode, artwork: image(p.artwork, ['still', 'backdrop', 'poster'], origin, 600, 338), startISO: p.start, endISO: p.end, startMs: start, endMs: end, navigable: airing || start - now <= 6 * 86400000 };
    }),
  };
}
