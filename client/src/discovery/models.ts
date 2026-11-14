import type { ArtworkRef, Bootstrap, Row, RowEntry, Title, TitleDetail } from '../../wire/v0/types';
import { artworkURL } from './artwork';
import { number, minute, clock, msg, plural } from '../../foundation/i18n';

function art(artwork: ArtworkRef[], kind: ArtworkRef['kind'], width: number, height: number, origin?: string): string {
  const ref = artwork.find(item => item.kind === kind);
  return ref ? artworkURL(ref, width, height, origin) ?? '' : '';
}
export function card(title: Title, receipt = '', origin?: string) {
  return { id: title.id, kind: title.kind, name: title.name, summary: title.summary, year: title.year ?? 0, rating: title.rating ?? '', durationSeconds: title.durationSeconds ?? 0, progressSeconds: title.watch?.positionSeconds ?? 0, played: title.watch?.played ?? false, seasonId: title.seasonId ?? '', seasonNumber: title.seasonNumber ?? 0, episodeNumber: title.episodeNumber ?? 0, genres: title.genres,
    yearLabel: title.year ? number(title.year, { useGrouping: false }) : '', progressLabel: title.durationSeconds ? number(Math.min(1, Math.max(0, (title.watch?.positionSeconds ?? 0) / title.durationSeconds)), { style: 'percent', maximumFractionDigits: 0 }) : '', seasonNumberLabel: title.seasonNumber ? number(title.seasonNumber) : '', episodeNumberLabel: title.episodeNumber ? number(title.episodeNumber) : '',
    facts: [title.year ? number(title.year, { useGrouping: false }) : '', title.rating ?? '', title.durationSeconds ? minute(Math.round(title.durationSeconds / 60)) : ''].filter(Boolean).join(' · '),
    poster: art(title.artwork, 'poster', 400, 600, origin), backdrop: art(title.artwork, 'backdrop', 1280, 720, origin),
    logo: art(title.artwork, 'logo', 400, 200, origin), accent: title.artwork.find(a => a.color)?.color ?? '', receipt };
}
export function entry(item: RowEntry, origin?: string) {
  if (item.kind === 'title') return card(item.title, item.receiptToken, origin);
  const artwork = item.kind === 'channel' ? item.channel.artwork : item.artwork;
  return { id: item.kind === 'channel' ? item.channel.id : item.targetId, kind: item.kind,
    name: item.kind === 'channel' ? item.channel.name : item.name, summary: '', facts: '', yearLabel: '', progressLabel: '', seasonNumberLabel: '', episodeNumberLabel: '', year: 0, rating: item.kind === 'channel' ? item.channel.rating ?? '' : '', durationSeconds: 0, progressSeconds: 0, played: false, seasonId: '', seasonNumber: 0, episodeNumber: 0, genres: [] as string[],
    poster: art(artwork, 'poster', 400, 600, origin), backdrop: art(artwork, 'backdrop', 1280, 720, origin),
    logo: art(artwork, 'logo', 400, 200, origin), accent: artwork.find(a => a.color)?.color ?? '', receipt: item.receiptToken };
}
export function feedRow(row: Row, origin?: string) {
  return { id: row.id, name: row.name, receipt: row.receiptToken, items: row.items.map(item => entry(item, origin)) };
}
export function homeModel(data: Bootstrap, origin?: string, now?: number) {
  const cached = data.hero?.trailer?.cachedPlayback;
  let trailerUrl = '';
  if (cached?.status === 'ready' && origin && now !== undefined && Date.parse(cached.expiresAt) > now) {
    try {
      const url = new URL(cached.url, `${origin}/`);
      if (url.origin === origin && url.pathname.startsWith('/sessions/media/')) trailerUrl = url.href;
    } catch { /* Invalid grant: leave preview unavailable. */ }
  }
  return { viewer: data.viewer.name, defaultSkinId: data.defaultSkinId, skins: data.capabilities.skins.map(s => s.id),
    hero: data.hero ? [card(data.hero.title, data.hero.receiptToken, origin)] : [], trailerReady: trailerUrl !== '', trailerUrl, trailerExpiresAt: trailerUrl && cached ? Date.parse(cached.expiresAt) : 0,
    rows: data.rows.map(row => feedRow(row, origin)),
    liveAvailable: data.capabilities.features.liveTV.available, aiAvailable: data.capabilities.features.aiSearch.available, descriptiveAvailable: data.capabilities.features.descriptiveSearch.available };
}
export function detailModel(data: TitleDetail, origin?: string) {
  const facts: string[] = [];
  const video = (data.mediaSummary?.video ?? []).filter(v => (v.width ?? 0) > 0 && (v.height ?? 0) > 0)
    .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0] ?? data.mediaSummary?.video[0];
  if (video?.width && video.height) facts.push(`${number(video.width, { useGrouping: false })} × ${number(video.height, { useGrouping: false })}`);
  if (video?.dolbyVisionProfile !== undefined) facts.push(msg('data.dolbyProfile', { profile: number(video.dolbyVisionProfile) }));
  else if (video?.colorTransfer) facts.push(msg('data.transfer', { transfer: video.colorTransfer }));
  for (const audio of data.mediaSummary?.audio ?? []) {
    const value = [audio.codec, audio.channels ? msg(`data.audioChannels.${plural(audio.channels)}`, { count: number(audio.channels) }) : '', audio.language].filter(Boolean).join(' · ');
    if (value && !facts.includes(value)) facts.push(value);
  }
  return { title: [card(data.title, '', origin)], related: [], mediaFacts: facts, resumePosition: clock(data.title.watch?.positionSeconds ?? 0), crew: (data.crew ?? []).map(c => c.role ? `${c.name} · ${c.role}` : c.name), canPlay: data.canPlay ?? false, resumeSeconds: data.title.watch?.positionSeconds ?? 0,
    seasons: (data.seasons ?? []).map(t => card(t, '', origin)), episodes: (data.episodes ?? []).map(t => card(t, '', origin)),
    extras: data.extras.map(e => ({ id: e.id, name: e.name, kind: e.kind, ready: e.availability === 'ready' })),
    cast: data.cast.map(c => c.role ? `${c.name} · ${c.role}` : c.name) };
}
