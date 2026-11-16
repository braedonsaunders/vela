// Projections of the wire's discovery data (home, rows, titles) into the display models of
// models.ts: labels formatted for the current locale, artwork sized for each slot.
import type { ArtworkRef, Bootstrap, Row as WireRow, RowEntry, Title, TitleDetail } from '../wire';
import type { Card, DetailModel, HeroAction, HomeModel, Person, PreviewGrant, Rating, Row } from '../models';
import { artworkURL, type Images } from './artwork';
import { clock, minute, msg, number, percent, plural } from '../i18n';

function art(artwork: ArtworkRef[], kind: ArtworkRef['kind'], width: number, height: number, images?: Images): string {
  const ref = artwork.find(item => item.kind === kind);
  return ref ? artworkURL(ref, width, height, images) ?? '' : '';
}

/** Poster, backdrop (or still), logo and accent for one set of artwork, sized from the display's art width. */
function pictures(artwork: ArtworkRef[], images: Images | undefined, artWidth: number, backdropWidth = artWidth) {
  const posterWidth = Math.min(600, Math.ceil(artWidth / 6));
  const logoWidth = Math.min(800, Math.ceil(artWidth / 3));
  return {
    poster: art(artwork, 'poster', posterWidth, Math.ceil(posterWidth * 1.5), images),
    // An episode often has only a still (a frame from it): that is its landscape art.
    backdrop: art(artwork, 'backdrop', backdropWidth, Math.ceil(backdropWidth * 9 / 16), images)
      || art(artwork, 'still', backdropWidth, Math.ceil(backdropWidth * 9 / 16), images),
    logo: art(artwork, 'logo', logoWidth, Math.ceil(logoWidth / 2), images),
    accent: artwork.find(a => a.color)?.color ?? '',
  };
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
    year: title.year ?? 0,
    rating: title.rating ?? '',
    durationSeconds: duration ?? 0,
    progressSeconds: position,
    played: title.watch?.played ?? false,
    seasonId: title.seasonId ?? '',
    seasonNumber: title.seasonNumber ?? 0,
    episodeNumber: title.episodeNumber ?? 0,
    genres: title.genres,
    durationLabel,
    yearLabel,
    progressLabel: duration ? percent(Math.min(1, Math.max(0, position / duration))) : '',
    seasonNumberLabel: title.seasonNumber ? number(title.seasonNumber) : '',
    episodeNumberLabel: title.episodeNumber ? number(title.episodeNumber) : '',
    facts: [yearLabel, title.rating ?? '', durationLabel].filter(Boolean).join(' · '),
    ...pictures(title.artwork, images, artWidth, backdropWidth),
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
    year: 0,
    rating,
    durationSeconds: 0,
    progressSeconds: 0,
    played: false,
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
    rows: data.rows.map(row => feedRow(row, images, artWidth)),
    nextCursor: data.nextCursor ?? '',
    liveAvailable: features.liveTV.available,
    aiAvailable: features.aiSearch.available,
    descriptiveAvailable: features.descriptiveSearch.available,
    trailerPreviewAvailable: features.trailerPreview?.available ?? false,
  };
}

/** Resolution, dynamic range and each distinct audio track, as display facts. */
function mediaFacts(data: TitleDetail): string[] {
  const facts: string[] = [];
  const area = (v: { width?: number; height?: number }) => (v.width ?? 0) * (v.height ?? 0);
  const sized = (data.mediaSummary?.video ?? []).filter(v => (v.width ?? 0) > 0 && (v.height ?? 0) > 0);
  const video = sized.sort((a, b) => area(b) - area(a))[0] ?? data.mediaSummary?.video[0];
  if (video?.width && video.height) facts.push(`${year(video.width)} × ${year(video.height)}`);
  if (video?.dolbyVisionProfile !== undefined) {
    facts.push(msg('data.dolbyProfile', { profile: number(video.dolbyVisionProfile) }));
  } else if (video?.colorTransfer) {
    facts.push(msg('data.transfer', { transfer: video.colorTransfer }));
  }
  for (const audio of data.mediaSummary?.audio ?? []) {
    const channels = audio.channels
      ? msg(`data.audioChannels.${plural(audio.channels)}`, { count: number(audio.channels) })
      : '';
    const value = [audio.codec, channels, audio.language].filter(Boolean).join(' · ');
    if (value && !facts.includes(value)) facts.push(value);
  }
  return facts;
}

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
): DetailModel {
  const person = (value: { name: string; role?: string; artwork?: ArtworkRef }): Person => {
    let portrait = '';
    if (value.artwork) {
      try {
        portrait = artworkURL(value.artwork, 160, 160, images) ?? '';
      } catch {
        // Malformed optional artwork is unavailable.
      }
    }
    return { name: value.name, role: value.role ?? '', portrait };
  };
  const credit = (c: { name: string; role?: string }) => (c.role ? `${c.name} · ${c.role}` : c.name);
  const theme = themeMusic(data, images, themeAvailable);
  const trailers = data.extras.filter(extra => extra.kind === 'trailer');
  const trailer = trailers.find(extra => extra.availability !== 'unavailable') ?? trailers[0];
  const position = data.title.watch?.positionSeconds ?? 0;
  return {
    title: [card(data.title, '', images, artWidth)],
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
    episodes: (data.episodes ?? []).map(t => card(t, '', images, artWidth)),
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
