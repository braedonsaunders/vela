import type { ArtworkRef, Bootstrap, Row, RowEntry, Title, TitleDetail } from '../../wire/v0/types';
import { artworkURL } from './artwork';
import { number, minute, clock, msg, plural } from '../../foundation/i18n';

function art(artwork: ArtworkRef[], kind: ArtworkRef['kind'], width: number, height: number, origin?: string): string {
  const ref = artwork.find(item => item.kind === kind);
  return ref ? artworkURL(ref, width, height, origin) ?? '' : '';
}
export function card(title: Title, receipt = '', origin?: string, artWidth = 2560) {
  const posterWidth = Math.min(600, Math.ceil(artWidth / 6));
  const logoWidth = Math.min(800, Math.ceil(artWidth / 3));
  return { id: title.id, kind: title.kind, name: title.name, summary: title.summary, year: title.year ?? 0, rating: title.rating ?? '', durationSeconds: title.durationSeconds ?? 0, progressSeconds: title.watch?.positionSeconds ?? 0, played: title.watch?.played ?? false, seasonId: title.seasonId ?? '', seasonNumber: title.seasonNumber ?? 0, episodeNumber: title.episodeNumber ?? 0, genres: title.genres,
    durationLabel: title.durationSeconds ? minute(Math.round(title.durationSeconds / 60)) : '', yearLabel: title.year ? number(title.year, { useGrouping: false }) : '', progressLabel: title.durationSeconds ? number(Math.min(1, Math.max(0, (title.watch?.positionSeconds ?? 0) / title.durationSeconds)), { style: 'percent', maximumFractionDigits: 0 }) : '', seasonNumberLabel: title.seasonNumber ? number(title.seasonNumber) : '', episodeNumberLabel: title.episodeNumber ? number(title.episodeNumber) : '',
    facts: [title.year ? number(title.year, { useGrouping: false }) : '', title.rating ?? '', title.durationSeconds ? minute(Math.round(title.durationSeconds / 60)) : ''].filter(Boolean).join(' · '),
    poster: art(title.artwork, 'poster', posterWidth, Math.ceil(posterWidth * 1.5), origin), backdrop: art(title.artwork, 'backdrop', artWidth, Math.ceil(artWidth * 9 / 16), origin),
    logo: art(title.artwork, 'logo', logoWidth, Math.ceil(logoWidth / 2), origin), accent: title.artwork.find(a => a.color)?.color ?? '', receipt };
}
export function entry(item: RowEntry, origin?: string, artWidth = 2560) {
  const posterWidth = Math.min(600, Math.ceil(artWidth / 6));
  const logoWidth = Math.min(800, Math.ceil(artWidth / 3));
  if (item.kind === 'title') return card(item.title, item.receiptToken, origin, artWidth);
  const artwork = item.kind === 'channel' ? item.channel.artwork : item.artwork;
  return { id: item.kind === 'channel' ? item.channel.id : item.targetId, kind: item.kind,
    name: item.kind === 'channel' ? item.channel.name : item.name, summary: '', facts: '', yearLabel: '', durationLabel: '', progressLabel: '', seasonNumberLabel: '', episodeNumberLabel: '', year: 0, rating: item.kind === 'channel' ? item.channel.rating ?? '' : '', durationSeconds: 0, progressSeconds: 0, played: false, seasonId: '', seasonNumber: 0, episodeNumber: 0, genres: [] as string[],
    poster: art(artwork, 'poster', posterWidth, Math.ceil(posterWidth * 1.5), origin), backdrop: art(artwork, 'backdrop', artWidth, Math.ceil(artWidth * 9 / 16), origin),
    logo: art(artwork, 'logo', logoWidth, Math.ceil(logoWidth / 2), origin), accent: artwork.find(a => a.color)?.color ?? '', receipt: item.receiptToken };
}
export function feedRow(row: Row, origin?: string, artWidth = 2560) {
  return { id: row.id, name: row.name, receipt: row.receiptToken, items: row.items.map(item => entry(item, origin, artWidth)), nextCursor: row.nextCursor ?? '', continuation: row.continuation, previewOnFocus: row.previewOnFocus ?? false, presentation: row.presentation ?? '' };
}
export function homeModel(data: Bootstrap, origin?: string, _now?: number, artWidth = 2560) {
  const heroes = (data.heroes ?? []).slice(0, 6);
  const previews: { id: string; url: string; expiresAt: number }[] = [];
  return { viewer: data.viewer.name, defaultSkinId: data.defaultSkinId, skins: data.capabilities.skins.map(s => s.id),
    hero: heroes.map(hero => card(hero.title, hero.receiptToken, origin, artWidth)),
    heroActions: heroes.map(hero => {
      const { title, action, reason } = hero;
      const sameTarget = action.titleId === title.id;
      const position = action.kind === 'resume' && sameTarget ? action.positionSeconds : undefined;
      const remaining = position !== undefined && title.durationSeconds !== undefined && title.durationSeconds > position && position >= 0 ? title.durationSeconds - position : undefined;
      const episode = sameTarget && title.kind === 'episode' && title.seasonNumber !== undefined && title.episodeNumber !== undefined;
      const actionLabel = episode && action.kind !== 'details'
        ? msg(`hero.action.${action.kind === 'resume' ? 'resumeEpisode' : 'playEpisode'}`, { season: number(title.seasonNumber!, { useGrouping: false }), episode: number(title.episodeNumber!, { useGrouping: false }) })
        : msg(`hero.action.${action.kind}`);
      return { heroId: title.id, reason, reasonLabel: hero.label || msg(`hero.reason.${reason}`), action: action.kind,
        targetId: action.titleId, targetKind: sameTarget ? title.kind : reason === 'nextEpisode' ? 'episode' : '', hasPosition: action.positionSeconds !== undefined, positionSeconds: action.positionSeconds ?? 0, actionLabel,
        actionDetail: remaining !== undefined ? msg('hero.detail.remaining', { time: minute(Math.ceil(remaining / 60)) }) : '',
        progress: position !== undefined && title.durationSeconds && title.durationSeconds > 0 ? Math.min(1, Math.max(0, position / title.durationSeconds)) : 0 };
    }), heroPreviewIds: heroes.filter(hero => hero.previewOnFocus === true).map(hero => hero.title.id), previews,
    rows: data.rows.map(row => feedRow(row, origin, artWidth)), nextCursor: data.nextCursor ?? '',
    liveAvailable: data.capabilities.features.liveTV.available, aiAvailable: data.capabilities.features.aiSearch.available, descriptiveAvailable: data.capabilities.features.descriptiveSearch.available, trailerPreviewAvailable: data.capabilities.features.trailerPreview?.available ?? false };
}
export function detailModel(data: TitleDetail, origin?: string, artWidth = 2560, extraPlayback = false, themeAvailable = false) {
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
  const person = (value: { name: string; role?: string; artwork?: ArtworkRef }) => {
    let portrait = '';
    if (value.artwork) {
      try { portrait = artworkURL(value.artwork, 160, 160, origin) ?? ''; } catch { /* Malformed optional artwork is unavailable. */ }
    }
    return { name: value.name, role: value.role ?? '', portrait };
  };
  let themeMusicUrl = '', themeMusicExpiresAt = 0;
  if (themeAvailable && origin && data.title.themeMusic && ['show', 'season', 'episode'].includes(data.title.kind)) {
    try {
      const url = new URL(data.title.themeMusic.url, `${origin}/`);
      const expires = Date.parse(data.title.themeMusic.expiresAt);
      if (url.origin === origin && !url.username && !url.password && !url.search && !url.hash && /^\/vela\/v0\/themes\/[a-f0-9]{64}\/theme\.m4a$/.test(url.pathname) && Number.isFinite(expires) && expires > 0) {
        themeMusicUrl = url.href;
        themeMusicExpiresAt = expires;
      }
    } catch { /* Invalid optional theme grant is unavailable. */ }
  }
  const trailers = data.extras.filter(extra => extra.kind === 'trailer');
  const trailer = trailers.find(extra => extra.availability !== 'unavailable') ?? trailers[0];
  const labels: Record<string, string> = { tomatoes: 'ratings.tomatoes', popcorn: 'ratings.popcorn', imdb: 'ratings.imdb', metacritic: 'ratings.metacritic', tmdb: 'ratings.tmdb', letterboxd: 'ratings.letterboxd' };
  const ratings = (data.title.ratings ?? []).filter(r => Number.isFinite(r.value) && Number.isFinite(r.scale) && r.scale > 0 && r.value >= 0 && r.value <= r.scale).map(r => ({
    source: r.source === 'tomatoes' && r.kind === 'critic' ? 'rt-critics' : r.source === 'popcorn' && r.kind === 'audience' ? 'rt-audience' : r.source,
    label: labels[r.source] ? msg(labels[r.source]!) : r.source,
    value: r.source === 'tomatoes' || r.source === 'popcorn' ? number(r.value / r.scale, { style: 'percent', maximumFractionDigits: 20 }) : number(r.value, { maximumFractionDigits: 20 }),
    score: r.value / r.scale * 100, state: r.state ?? '',
  }));
  return { title: [card(data.title, '', origin, artWidth)], ratings, trailerId: trailer?.id ?? '', trailerReady: !!trailer && extraPlayback && trailer.availability !== 'unavailable', themeMusicUrl, themeMusicExpiresAt, related: [], mediaFacts: facts, resumePosition: clock(data.title.watch?.positionSeconds ?? 0), crew: (data.crew ?? []).map(c => c.role ? `${c.name} · ${c.role}` : c.name), crewPeople: (data.crew ?? []).map(person), canPlay: data.canPlay ?? false, resumeSeconds: data.title.watch?.positionSeconds ?? 0,
    seasons: (data.seasons ?? []).map(t => card(t, '', origin, artWidth)), episodes: (data.episodes ?? []).map(t => card(t, '', origin, artWidth)),
    extras: data.extras.map(e => ({ id: e.id, name: e.name, kind: e.kind, ready: extraPlayback && e.kind === 'trailer' && e.availability !== 'unavailable' })),
    cast: data.cast.map(c => c.role ? `${c.name} · ${c.role}` : c.name),
    castPeople: data.cast.map(person) };
}
