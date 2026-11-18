// Projections of the wire's discovery data (home, rows, titles) into the display models of
// models.ts: labels formatted for the current locale, artwork sized for each slot.
import type { ArtworkRef, Bootstrap, Row as WireRow, RowEntry, Title, TitleDetail } from '../wire';
import type { Card, DetailModel, HeroAction, HomeModel, Person, PreviewGrant, Rating, Row } from '../models';
import { artworkURL, type Images } from './artwork';
import { clock, minute, msg, number, percent, plural, localeContext } from '../i18n';

function art(artwork: ArtworkRef[], kind: ArtworkRef['kind'], width: number, height: number, images?: Images): string {
  const ref = artwork.find(item => item.kind === kind);
  return ref ? artworkURL(ref, width, height, images) ?? '' : '';
}

/** Poster, backdrop (or still), logo and accent for one set of artwork, sized from the display's art width. */
function pictures(artwork: ArtworkRef[], images: Images | undefined, artWidth: number, backdropWidth = artWidth, preferStill = false) {
  const posterWidth = Math.min(600, Math.ceil(artWidth / 6));
  const logoWidth = Math.min(800, Math.ceil(artWidth / 3));
  return {
    poster: art(artwork, 'poster', posterWidth, Math.ceil(posterWidth * 1.5), images),
    // An episode often has only a still (a frame from it): that is its landscape art.
    backdrop: art(artwork, preferStill ? 'still' : 'backdrop', backdropWidth, Math.ceil(backdropWidth * 9 / 16), images)
      || art(artwork, preferStill ? 'backdrop' : 'still', backdropWidth, Math.ceil(backdropWidth * 9 / 16), images)
      || art(artwork, 'thumb', backdropWidth, Math.ceil(backdropWidth * 9 / 16), images),
    logo: art(artwork, 'logo', logoWidth, Math.ceil(logoWidth / 2), images),
    accent: artwork.find(a => a.color)?.color ?? '',
  };
}

function airDateLabel(value?: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(localeContext().formatLocale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date)
    : '';
}

const year = (value: number) => number(value, { useGrouping: false });

export function card(title: Title, receipt = '', images?: Images, artWidth = 2560, backdropWidth = artWidth): Card {
  const duration = title.durationSeconds;
  const position = title.watch?.positionSeconds ?? 0;
  const durationLabel = duration ? minute(Math.round(duration / 60)) : '';
  const yearLabel = title.year ? year(title.year) : '';
  return {
    id: title.id,
    kind: title.kind,
    name: title.name,
    summary: title.summary,
    airDate: title.airDate ?? '',
    year: title.year ?? 0,
    rating: title.rating ?? '',
    durationSeconds: duration ?? 0,
    progressSeconds: position,
    played: title.watch?.played ?? false,
    showId: title.showId ?? '',
    showName: title.showName ?? '',
    episodeContext: [
      title.showName,
      title.seasonNumber !== undefined && title.episodeNumber !== undefined
        ? msg('detail.seasonEpisode', { season: year(title.seasonNumber), episode: year(title.episodeNumber) })
        : title.episodeNumber !== undefined ? msg('marquee.episodeNumber', { episode: year(title.episodeNumber) }) : '',
    ].filter(Boolean).join(' · '),
    contextParts: [
      ...(title.showName ? [{ label: title.showName, select: title.showId ? `${title.showId}|` : '' }] : []),
      ...(title.seasonNumber !== undefined ? [{ label: `${msg('ui.season')} ${year(title.seasonNumber)}`, select: title.showId ? `${title.seasonId || `@number:${title.seasonNumber}`}|season||${title.showId}` : '' }] : []),
      ...(title.episodeNumber !== undefined ? [{ label: msg('marquee.episodeNumber', { episode: year(title.episodeNumber) }), select: title.id ? `${title.id}|` : '' }] : []),
    ],
    seasonId: title.seasonId ?? '',
    seasonNumber: title.seasonNumber ?? 0,
    episodeNumber: title.episodeNumber ?? 0,
    genres: title.genres,
    durationLabel,
    yearLabel,
    progressLabel: duration ? percent(Math.min(1, Math.max(0, position / duration))) : '',
    seasonNumberLabel: title.seasonNumber ? number(title.seasonNumber) : '',
    episodeNumberLabel: title.episodeNumber ? number(title.episodeNumber) : '',
    facts: [title.kind === 'episode' ? airDateLabel(title.airDate) || yearLabel : yearLabel, title.rating ?? '', durationLabel].filter(Boolean).join(' · '),
    ...pictures(title.artwork, images, artWidth, backdropWidth, title.kind === 'episode'),
    receipt,
  };
}

/** A row card's backdrop is never wider than this many pixels, whatever the display: at the
 * display's full art width (3840 on a 4K TV), decoded once per card, they exhausted the Apple TV's
 * memory. Heroes and title pages keep the full width. */
const CARD_BACKDROP_WIDTH = 1280;

export function entry(item: RowEntry, images?: Images, artWidth = 2560): Card {
  const backdropWidth = Math.min(artWidth, CARD_BACKDROP_WIDTH);
  if (item.kind === 'title') return card(item.title, item.receiptToken, images, artWidth, backdropWidth);
  if (item.kind === 'channel') {
    const { id, name, rating, artwork } = item.channel;
    const art = pictures(artwork, images, artWidth, backdropWidth);
    return plainCard(id, item.kind, name, rating ?? '', art, item.receiptToken);
  }
  const art = pictures(item.artwork, images, artWidth, backdropWidth);
  return plainCard(item.targetId, item.kind, item.name, '', art, item.receiptToken);
}

/** A card for an entry that is not a title: a name and artwork, no facts. */
function plainCard(id: string, kind: string, name: string, rating: string, art: ReturnType<typeof pictures>, receipt: string): Card {
  return {
    id,
    kind,
    name,
    summary: '',
    facts: '',
    yearLabel: '',
    durationLabel: '',
    progressLabel: '',
    seasonNumberLabel: '',
    episodeNumberLabel: '',
    airDate: '',
    year: 0,
    rating,
    durationSeconds: 0,
    progressSeconds: 0,
    played: false,
    showId: '',
    showName: '',
    episodeContext: '',
    contextParts: [],
    seasonId: '',
    seasonNumber: 0,
    episodeNumber: 0,
    genres: [],
    ...art,
    receipt,
  };
}

export function feedRow(row: WireRow, images?: Images, artWidth = 2560): Row {
  return {
    id: row.id,
    name: row.name,
    receipt: row.receiptToken,
    items: row.items.map(item => entry(item, images, artWidth)),
    nextCursor: row.nextCursor ?? '',
    continuation: row.continuation,
    previewOnFocus: row.previewOnFocus ?? false,
    presentation: row.presentation ?? '',
  };
}

type WireHero = NonNullable<Bootstrap['heroes']>[number];

function heroAction(hero: WireHero): HeroAction {
  const { title, action, reason } = hero;
  const sameTarget = action.titleId === title.id;
  // The decoration reads the title's own watch state: the action names no position (the server
  // resolves where to resume when playback starts, so a cached Home never replays a stale one).
  const position = action.kind === 'resume' && sameTarget ? title.watch?.positionSeconds : undefined;
  const duration = title.durationSeconds;
  const remaining = position !== undefined && duration !== undefined && duration > position && position >= 0
    ? duration - position
    : undefined;
  const episode = sameTarget && title.kind === 'episode'
    && title.seasonNumber !== undefined && title.episodeNumber !== undefined;
  const actionLabel = episode && action.kind !== 'details'
    ? msg(`hero.action.${action.kind === 'resume' ? 'resumeEpisode' : 'playEpisode'}`, {
      season: year(title.seasonNumber!),
      episode: year(title.episodeNumber!),
    })
    : msg(`hero.action.${action.kind}`);
  return {
    heroId: title.id,
    reason,
    reasonLabel: hero.label || msg(`hero.reason.${reason}`),
    action: action.kind,
    targetId: action.titleId,
    targetKind: sameTarget ? title.kind : reason === 'nextEpisode' ? 'episode' : '',
    actionLabel,
    actionDetail: remaining !== undefined ? msg('hero.detail.remaining', { time: minute(Math.ceil(remaining / 60)) }) : '',
    progress: position !== undefined && duration && duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0,
  };
}

export function homeModel(data: Bootstrap, images?: Images, artWidth = 2560): HomeModel {
  const heroes = (data.heroes ?? []).slice(0, 6);
  const previews: PreviewGrant[] = [];
  const features = data.capabilities.features;
  return {
    viewer: data.viewer.name,
    defaultSkinId: data.defaultSkinId,
    skins: data.capabilities.skins.map(s => s.id),
    hero: heroes.map(hero => card(hero.title, hero.receiptToken, images, artWidth)),
    heroActions: heroes.map(heroAction),
    heroPreviewIds: heroes.filter(hero => hero.previewOnFocus === true).map(hero => hero.title.id),
    previews,
    // A row with nothing in it (no shows to continue, say) is a heading over an empty shelf: left out.
    rows: data.rows.filter(row => row.items.length > 0).map(row => feedRow(row, images, artWidth)),
    nextCursor: data.nextCursor ?? '',
    liveAvailable: features.liveTV.available,
    aiAvailable: features.aiSearch.available,
    descriptiveAvailable: features.descriptiveSearch.available,
    trailerPreviewAvailable: features.trailerPreview?.available ?? false,
  };
}

/** A title's technical summary stays compact; individual tracks belong in the player menus. */
function mediaFacts(data: TitleDetail): string[] {
  const summary = data.mediaSummary;
  if (!summary) return [];
  const facts: string[] = [];
  const area = (v: { width?: number; height?: number }) => (v.width ?? 0) * (v.height ?? 0);
  const sized = summary.video.filter(v => (v.width ?? 0) > 0 && (v.height ?? 0) > 0);
  const video = sized.sort((a, b) => area(b) - area(a))[0] ?? summary.video[0];
  const width = video?.width ?? 0, height = video?.height ?? 0;
  // Cinema crops keep the encoded width's resolution class (3840 × 1600 is still 4K).
  const resolution = width >= 7680 || height >= 4320 ? '8K'
    : width >= 3840 || height >= 2160 ? '4K'
    : width >= 2560 || height >= 1440 ? '1440p'
    : width >= 1920 || height >= 1080 ? '1080p'
    : width >= 1280 || height >= 720 ? '720p' : height > 0 ? `${year(height)}p` : '';
  const transfer = video?.colorTransfer?.toLowerCase().replace(/[^a-z0-9+]/g, '');
  const range = video?.dolbyVisionProfile !== undefined || transfer === 'dolbyvision' ? 'Dolby Vision'
    : transfer === 'hdr10+' || transfer === 'hdr10plus' ? 'HDR10+'
    : transfer === 'smpte2084' || transfer === 'pq' || transfer === 'hdr10' ? 'HDR10'
    : transfer === 'aribstdb67' || transfer === 'hlg' ? 'HLG' : '';
  const picture = [resolution, range].filter(Boolean).join(' · ');
  if (picture) facts.push(picture);

  const audio = summary.audio.find(track => track.default) ?? summary.audio.find(track => track.codec || track.channels);
  if (audio) {
    const codec = audio.codec ? AUDIO_FORMATS[audio.codec.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? audio.codec.toUpperCase() : '';
    const channels = audio.channels ? ({ 1: '1.0', 2: '2.0', 6: '5.1', 8: '7.1' } as Record<number, string>)[audio.channels]
      ?? msg(`data.audioChannels.${plural(audio.channels)}`, { count: number(audio.channels) }) : '';
    const sound = [codec, channels].filter(Boolean).join(' · ');
    if (sound) facts.push(sound);
  }

  // Older Ether summaries have no subtitle count: never infer zero from a missing field.
  const subtitles = summary.subtitleCount;
  const knownSubtitles = subtitles !== undefined && Number.isInteger(subtitles) && subtitles >= 0;
  if (summary.audio.length > 1 || (knownSubtitles && subtitles > 0)) {
    const counts = [
      summary.audio.length ? msg(`data.audioTracks.${plural(summary.audio.length)}`, { count: number(summary.audio.length) }) : '',
      knownSubtitles ? msg(`data.subtitleTracks.${plural(subtitles)}`, { count: number(subtitles) }) : '',
    ].filter(Boolean).join(' · ');
    if (counts) facts.push(counts);
  }
  return facts;
}

const AUDIO_FORMATS: Record<string, string> = {
  aac: 'AAC', ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', truehd: 'TrueHD',
  dca: 'DTS', dts: 'DTS', dtshd: 'DTS-HD', dtshdma: 'DTS-HD MA',
  flac: 'FLAC', alac: 'ALAC', opus: 'Opus', mp3: 'MP3', pcm: 'PCM',
};

const RATING_LABELS: Record<string, string> = {
  tomatoes: 'ratings.tomatoes',
  popcorn: 'ratings.popcorn',
  imdb: 'ratings.imdb',
  metacritic: 'ratings.metacritic',
  tmdb: 'ratings.tmdb',
  letterboxd: 'ratings.letterboxd',
};

function ratings(title: Title): Rating[] {
  const valid = (title.ratings ?? []).filter(r =>
    Number.isFinite(r.value) && Number.isFinite(r.scale) && r.scale > 0 && r.value >= 0 && r.value <= r.scale);
  return valid.map(r => {
    const tomatoes = r.source === 'tomatoes' || r.source === 'popcorn';
    const tenths = r.source === 'imdb' || r.source === 'tmdb' || r.source === 'letterboxd';
    let source: string = r.source;
    if (r.source === 'tomatoes' && r.kind === 'critic') source = 'rt-critics';
    if (r.source === 'popcorn' && r.kind === 'audience') source = 'rt-audience';
    let value: string;
    if (tomatoes) value = percent(r.value / r.scale);
    else if (tenths) value = number(r.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    else value = number(r.value, { maximumFractionDigits: r.source === 'metacritic' ? 0 : 20 });
    const label = RATING_LABELS[r.source] ? msg(RATING_LABELS[r.source]!) : r.source;
    return { source, label, value, score: r.value / r.scale * 100, state: r.state ?? '' };
  });
}

/** Ether's theme music grant, only for series titles on Ether's own origin. */
function themeMusic(data: TitleDetail, images: Images | undefined, available: boolean): { url: string; expiresAt: number } {
  const none = { url: '', expiresAt: 0 };
  const grant = data.title.themeMusic;
  if (!available || !images || images.sized || !grant) return none;
  if (!['show', 'season', 'episode'].includes(data.title.kind)) return none;
  try {
    const url = new URL(grant.url, `${images.origin}/`);
    const expires = Date.parse(grant.expiresAt);
    const plain = !url.username && !url.password && !url.search && !url.hash;
    const path = /^\/vela\/v0\/themes\/[a-f0-9]{64}\/theme\.m4a$/.test(url.pathname);
    if (url.origin === images.origin && plain && path && Number.isFinite(expires) && expires > 0) {
      return { url: url.href, expiresAt: expires };
    }
  } catch {
    // An invalid optional theme grant is unavailable.
  }
  return none;
}

export function detailModel(
  data: TitleDetail,
  images?: Images,
  artWidth = 2560,
  extraPlayback = false,
  themeAvailable = false,
  personFilmography = false,
): DetailModel {
  const person = (value: { id?: string; name: string; role?: string; artwork?: ArtworkRef }): Person => {
    let portrait = '';
    if (value.artwork) {
      try {
        portrait = artworkURL(value.artwork, 160, 160, images) ?? '';
      } catch {
        // Malformed optional artwork is unavailable.
      }
    }
    return { ...(value.id ? { id: value.id } : {}), ...(value.id && personFilmography ? { canOpen: true } : {}), name: value.name, role: value.role ?? '', portrait };
  };
  const credit = (c: { name: string; role?: string }) => (c.role ? `${c.name} · ${c.role}` : c.name);
  const theme = themeMusic(data, images, themeAvailable);
  const trailers = data.extras.filter(extra => extra.kind === 'trailer');
  const trailer = trailers.find(extra => extra.availability !== 'unavailable') ?? trailers[0];
  const position = data.title.watch?.positionSeconds ?? 0;
  // Ether supplies seasonNumber without seasonId. Resolve the relationship while the wire's
  // optional number is still distinguishable from the display model's default zero.
  const seasons = data.seasons ?? [];
  const episodeCard = (episode: Title): Card => {
    const exact = seasons.find(season => season.id === episode.seasonId);
    const numbered = episode.seasonNumber === undefined ? [] : seasons.filter(season => season.seasonNumber === episode.seasonNumber);
    const parent = exact ?? (numbered.length === 1 ? numbered[0] : undefined);
    const seasonId = episode.seasonId || parent?.id || (data.title.kind === 'season' ? data.title.id : undefined);
    return card({ ...episode, seasonId }, '', images, artWidth);
  };
  const titleCard = card(data.title, '', images, artWidth);
  // Title pages use the background; shelves and episode rows keep their landscape still.
  const backdrop = art(data.title.artwork, 'backdrop', artWidth, Math.ceil(artWidth * 9 / 16), images) || titleCard.backdrop;
  return {
    title: [{ ...titleCard, backdrop }],
    ratings: ratings(data.title),
    trailerId: trailer?.id ?? '',
    trailerReady: !!trailer && extraPlayback && trailer.availability !== 'unavailable',
    themeMusicUrl: theme.url,
    themeMusicExpiresAt: theme.expiresAt,
    related: [],
    mediaFacts: mediaFacts(data),
    resumePosition: clock(position),
    crew: (data.crew ?? []).map(credit),
    crewPeople: (data.crew ?? []).map(person),
    canPlay: data.canPlay ?? false,
    resumeSeconds: position,
    seasons: (data.seasons ?? []).map(t => card(t, '', images, artWidth)),
    nextUp: data.nextUp === undefined ? undefined : data.nextUp ? [episodeCard(data.nextUp)] : [],
    episodes: (data.episodes ?? []).map(episodeCard),
    extras: data.extras.map(e => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      ready: extraPlayback && e.kind === 'trailer' && e.availability !== 'unavailable',
    })),
    cast: data.cast.map(credit),
    castPeople: data.cast.map(person),
    pending: data.pending ?? [],
  };
}
