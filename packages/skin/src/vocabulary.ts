// The binding vocabulary (docs/skin-schema.md): every key a document may read, as an accessor
// over the binding context (the repeated item a node sits in) and the environment (the app's
// view state). The semantics are those of the Contract renderer's table (tools/renderer.ts),
// key for key. A template calls only the accessors it names.
import { cardFacts, joinMeta } from './meta-line';
import { identityKeys } from './identity-keys';
import { pagerBinding, pagerState } from './pager-book';
import { drawnAs, duration, isUnreleased, msg, releaseLabel, videoRoleLabel } from '@vela/core';
import { shouldRotateHero } from './hero-rotation';
import { selectEnv } from './host-source';
import { aboutLabel, aboutLine, type About } from './about';
import type { detailModel, entry, GuideChannel, homeModel } from '@vela/core';
import type { Hit, SearchView } from './widgets/search/model';
import type { AuthView } from './widgets/auth/model';
import { AUTH_VOCABULARY, quickChars } from './widgets/auth/vocabulary';
import { PREVIEW_VOCABULARY, type PreviewView } from './widgets/common/preview-vocabulary';
import { SEARCH_VOCABULARY, searchCollection } from './widgets/search/vocabulary';
import type { LiveView } from './widgets/guide/controller';
import { LIVE_VOCABULARY, liveCollection } from './widgets/guide/vocabulary';
import type { CollectionPage, LibraryOption, LibraryPage } from './widgets/library/model';
import { LIBRARY_VOCABULARY, libraryCollection } from './widgets/library/vocabulary';
import type { ScreenScope } from './screen/scope';

/** A card: a title, or a row entry that is not one (a collection, channel, playlist or directory). */
export type Card = ReturnType<typeof entry>;
export type HomeModel = ReturnType<typeof homeModel>;
export type DetailModel = ReturnType<typeof detailModel>;
export type Row = HomeModel['rows'][number];
export type HeroAction = HomeModel['heroActions'][number];
export type Extra = DetailModel['extras'][number];
export type Person = DetailModel['castPeople'][number];

export interface Destination { id: string; name: string; kind: string; backdrop: string }

/** The view state documents read. A key whose model is absent (an area not drawn yet) reads nothing. */
export interface Env {
  viewer: string;
  /** The viewer's picture for the profile control; '' where the server gives none. */
  viewerAvatar?: string;
  section: string;
  query: string;
  small: boolean;
  tv: boolean;
  still: boolean;
  /** The lite render tier (device-tier.ts): TV hardware that cannot keep up with the full render gets the
   * same look without its costliest effects (trailer previews, image blurs, fades, shadows). */
  lite?: boolean;
  canLive: boolean;
  canPlaylists: boolean;
  canSwitchProfile: boolean;
  width: number;
  /** Screen documents (env.canMultiview, env.canPlay): multiview is available here; playback is (default true). */
  canMultiview?: boolean;
  canPlay?: boolean;
  /** Screen documents (env.isTV): a TV device, where env.tv is the TV class (a TV, or a window 1600px or wider). */
  isTV?: boolean;
  /** Screen documents, renderer 20: the device can run the music visualizer (env.canVisualize); the
   * platform (env.platform: ios, android, web, desktop, tv); the form factor (env.form: small, wide, tv,
   * fold); a foldable's posture while partly open (env.fold: book, tabletop; '' otherwise). */
  canVisualize?: boolean;
  platform?: 'ios' | 'android' | 'web' | 'desktop' | 'tv';
  form?: 'small' | 'wide' | 'tv' | 'fold';
  fold?: '' | 'book' | 'tabletop';
  home?: HomeModel;
  heroIndex: number;
  libraries: Destination[];
  skinCount: number;
  skinName: string;
  /** The About line's facts: this build, where it runs, the connected server (about.ts). */
  about?: About;
  homeLoading: boolean;
  homeSlow: boolean;
  detail?: DetailModel;
  season: string;
  route: string;
  load: 'loading' | 'failed' | 'ready';
  loadFailure?: import('@vela/core').FailureKind;
  entry: string;
  flags: string[];
  rowLoading: string[];
  /** The shell's navigation row (`fit: 'nav'`): the destinations it has no room for (section keys:
   *  a library id, `live`), and whether the hidden copy measuring it is drawing (the renderer's own). */
  navOut?: string[];
  navMeasuring?: boolean;
  /** The open query's search answer (routes.search); none while no query is open. */
  search?: SearchView;
  /** The signed-out page (routes.auth); none while signed in. */
  auth?: AuthView;
  /** The card and hero whose trailer previews play now. */
  preview?: PreviewView;
  /** Live TV (the guide, a live home's monitor and listings); none where the server has no live TV. */
  live?: LiveView;
  /** The library page on show (routes.library); none on other routes. */
  library?: LibraryPage;
  /** The collection page on show (routes.collection); none on other routes. */
  collection?: CollectionPage;
  personPage?: {
    name: string; portrait: string; role: string; biography?: string; birthday?: string; items: Card[]; more: boolean; loading: boolean;
    /** The card shape of the library the person was opened from (library.card); poster without one. */
    card?: 'poster' | 'landscape' | 'square';
    /** The headings over the person's movie-kind and other titles: "Movies" and "TV Shows", or
     * "Titles" in a library that holds neither (core's personSectionLabels). */
    moviesLabel?: string;
    tvLabel?: string;
  };
}

/** The binding context: the item a node is repeated over, and its position. */
export interface Ctx {
  contextPart?: Card['contextParts'][number];
  card?: Card;
  hero?: Card;
  heroAct?: HeroAction;
  row?: Row;
  rowVisibleCount?: number;
  dest?: Destination;
  extra?: Extra;
  person?: Person;
  fact?: string;
  /** A season's compact selector label; absent when the same card appears outside a selector. */
  seasonLabel?: string;
  hit?: Hit;
  searchSection?: import('@vela/core').SearchSection;
  searchResult?: import('@vela/core').SearchResult;
  /** A channel of live.channels or live.favorites. */
  ch?: GuideChannel;
  /** A kind, genre or sort of library.kinds, library.genres or library.sorts. */
  opt?: LibraryOption;
  /** The identity of a row or card in a shelf (identityKeys): kept when the shelf reorders. */
  key?: string;
  /** A screen or surface document's data, records, local state and item aliases (screen/scope.ts). */
  screen?: ScreenScope;
  index: number;
}


export type Accessor = (c: Ctx, e: Env) => string;

const yes = (value: boolean) => (value ? 'true' : 'false');
const pct = (at: number, of: number) => (of > 0 ? String(Math.min(100, (at / of) * 100)) : '0');
const t = (key: string, params: Record<string, string> = {}) => msg(key, params);

/** A card's accessible name: title, year and progress (Contract's cardName). */
function cardName(x: Card): string {
  const progress = x.played ? t('ui.watched') : x.progressSeconds > 0 && x.durationSeconds > 0 ? t('ui.progressComplete', { progress: x.progressLabel }) : '';
  return t('ui.openTitleYearProgress', { title: x.name, year: x.year > 0 ? t('ui.year', { year: x.yearLabel }) : '', progress });
}
const factsLine = (x: Card) => joinMeta([x.facts, ...x.genres.slice(0, 3)]);
const kindId = (x: Card) => `${x.id}|${x.kind}|${x.receipt}`;

/** A title's kind as the page names it. A media class (music, books, audiobooks) names it by its
 * role: a plugin's book still arrives as kind 'movie', the structural projection, and is no film. */
/** The kind a title page names: a plugin video child by its own role ("Concert"), else kindLabelKey's word. */
export function kindLabel(x: Pick<Card, 'kind' | 'media' | 'videoRole'>): string {
  return (x.videoRole && !x.media ? videoRoleLabel(x.videoRole) : '') || t(kindLabelKey(x));
}
export function kindLabelKey(x: Pick<Card, 'kind' | 'media'>): string {
  const media = x.media;
  if (media && media.class !== 'video') {
    switch (media.role) {
      case 'artist': return 'media.ui.artist';
      case 'album': return 'media.ui.album';
      case 'track': return 'media.ui.song';
      case 'series': return 'media.ui.series';
      case 'audiobook': return 'media.ui.audiobook';
      case 'book': return 'media.ui.book';
      case 'part': return 'media.ui.part';
    }
    if (media.class === 'photo') return 'media.ui.photo';
    if (media.class === 'podcast') return media.role === 'show' ? 'media.ui.podcast' : 'media.ui.episode';
    if (media.class === 'book') return 'media.ui.book';
    if (media.class === 'audiobook') return 'media.ui.audiobook';
    if (media.class === 'music') return 'media.ui.album';
  }
  return x.kind === 'movie' ? 'ui.film' : x.kind === 'show' ? 'ui.series' : x.kind === 'season' ? 'ui.season' : 'ui.episode';
}
/** All skins read the same season scope; a stale selection from another title falls back. */
function selectedSeason(d: DetailModel | undefined, season: string): string {
  if (!season && d?.pending.includes('episodes')) return '';
  return d?.seasons.some(s => s.id === season) ? season : d?.seasons[0]?.id ?? '';
}
function seasonEpisodes(d: DetailModel | undefined, season: string): Card[] {
  const selected = selectedSeason(d, season);
  return (d?.episodes ?? []).filter(card => !selected || card.seasonId === selected);
}
const reading = (x: Card) => x.media?.readingFraction ?? 0;
/** A resume point: a rewatch keeps its bar, so the watched check gives way to it. */
const resuming = (x: Pick<Card, 'progressSeconds' | 'durationSeconds'>) => x.progressSeconds > 0 && x.durationSeconds > 0;
const hasProgress = (x: Card) => resuming(x) || !x.played && reading(x) > 0 && reading(x) < 0.98;
/** The watched check on a card: a played film, episode, season or series. Never beside a resume
 * bar, and never on music, books or audiobooks (their pages show their own read and heard state). */
export const watchedMark = (x: Pick<Card, 'played' | 'progressSeconds' | 'durationSeconds' | 'media'>): boolean =>
  x.played && !resuming(x) && (!x.media || x.media.class === 'video');

export function seasonDisplayName(card: Card): string {
  const name = card.name.trim();
  if (card.seasonNumber <= 0 || !name) return name || card.seasonNumberLabel;
  const generic = new RegExp(`^(?:season|series|s)\\s*0*${card.seasonNumber}$`, 'i').test(name);
  return generic ? name : `S${card.seasonNumberLabel || card.seasonNumber} · ${name}`;
}

/** A series' primary action targets the server's Next Up episode, or the first unwatched episode. */
function detailPlaybackCard(d: DetailModel): Card | undefined {
  if (isUnreleased(d.title[0]?.airDate)) return;
  const target = d.canPlay ? d.title[0] : d.nextUp?.[0] ?? d.episodes.find(card => !card.played);
  if (!isUnreleased(target?.airDate)) return target;
}

/** A card or hero field, read from whichever the context holds. */
function from(field: 'card' | 'hero', read: (x: Card) => string): Accessor {
  return c => {
    const x = c[field];
    return x ? read(x) : '';
  };
}
function title(read: (x: Card, d: DetailModel) => string, none = ''): Accessor {
  return (_, e) => {
    const x = e.detail?.title[0];
    return e.detail && x ? read(x, e.detail) : none;
  };
}
function detail(read: (d: DetailModel, e: Env) => string, none = ''): Accessor {
  return (_, e) => (e.detail ? read(e.detail, e) : none);
}

const CARD_FIELDS = ['id', 'kind', 'name', 'summary', 'yearLabel', 'rating', 'progressLabel', 'poster', 'backdrop', 'logo', 'accent', 'receipt'] as const;
const DETAIL_FIELDS = ['id', 'kind', 'name', 'summary', 'poster', 'backdrop', 'logo', 'accent', 'receipt'] as const;

export const VOCABULARY: Record<string, Accessor> = {
  'personPage.name': (_, e) => e.personPage?.name ?? '',
  'personPage.portrait': (_, e) => e.personPage?.portrait ?? '',
  'personPage.role': (_, e) => e.personPage?.role ?? '',
  'personPage.biography': (_, e) => e.personPage?.biography ?? '',
  'personPage.birthday': (_, e) => e.personPage?.birthday ?? '',
  'personPage.initials': (_, e) => (e.personPage?.name ?? '').split(' ').slice(0, 2).map(w => w.slice(0, 1)).join('').toUpperCase(),
  'personPage.paging': (_, e) => yes(!!e.personPage?.items.length),
  'personPage.empty': (_, e) => yes(e.load === 'ready' && !!e.personPage && !e.personPage.items.length && !e.personPage.loading),
  'personPage.emptyText': (_, e) => t('person.empty', { name: e.personPage?.name ?? '' }),
  'personPage.moviesLabel': (_, e) => e.personPage?.moviesLabel || t('person.movies'),
  'personPage.tvLabel': (_, e) => e.personPage?.tvLabel || t('person.tvShows'),
  'personPage.moviesCount': (_, e) => String(e.personPage?.items.filter(c => c.kind === 'movie').length ?? 0),
  'personPage.tvCount': (_, e) => String(e.personPage?.items.filter(c => c.kind !== 'movie').length ?? 0),
  'personPage.more': (_, e) => yes(!!e.personPage?.more),
  'personPage.loading': (_, e) => yes(!!e.personPage?.loading),
  'context.label': c => c.contextPart?.label ?? '',
  'context.select': c => c.contextPart?.select ?? '',
  'card.hasContext': from('card', x => yes(x.contextParts.length > 0)),
  /** The context parts as one line (series · season · episode), for a card too narrow for the links. */
  'card.contextLine': from('card', x => joinMeta(x.contextParts.map(part => part.label))),
  ...Object.fromEntries(CARD_FIELDS.flatMap(f => [[`card.${f}`, from('card', x => String(x[f]))], [`hero.${f}`, from('hero', x => String(x[f]))]])),
  'card.name': c => c.seasonLabel ?? c.card?.name ?? '',
  'card.played': from('card', x => yes(watchedMark(x))),
  'card.episodeNumberLabel': from('card', x => x.episodeNumberLabel),
  'card.durationLabel': from('card', x => x.durationLabel),
  'card.progressPct': from('card', x => reading(x) > 0 ? pct(reading(x), 1) : pct(x.progressSeconds, x.durationSeconds)),
  /** Music, book and audiobook cards (docs/media-kinds.md): the cover shape ('' follows the row or library), role and byline. */
  'card.shape': from('card', x => x.shape ?? ''),
  'card.role': from('card', x => x.media?.role ?? ''),
  'card.byline': from('card', x => x.media?.byline ?? ''),
  'card.hasProgress': from('card', x => yes(hasProgress(x))),
  'card.label': from('card', cardName),
  'card.kindId': from('card', kindId),
  'hero.kindId': from('hero', kindId),
  // A phone's narrow cards wrap their facts between facts; wider and TV layouts keep the one line.
  'card.facts': (c, e) => c.card ? e.small && !e.tv ? cardFacts([c.card.facts], c.card.rating) : joinMeta([c.card.facts]) : '',
  'hero.facts': from('hero', x => joinMeta([x.facts])),
  'card.factsLine': from('card', factsLine),
  'hero.factsLine': from('hero', factsLine),
  'card.seed': from('card', x => String(x.id.length)),
  'hero.seed': from('hero', x => String(x.id.length)),
  'card.nameLength': from('card', x => String(x.name.length)),
  'hero.nameLength': from('hero', x => String(x.name.length)),
  'card.seasonNumber': from('card', x => String(x.seasonNumber)),
  'card.episodeNumber': from('card', x => String(x.episodeNumber)),
  'card.seasonNumberLabel': from('card', x => x.seasonNumberLabel),
  'card.unwatched': from('card', x => yes((x.kind === 'movie' || x.kind === 'episode') && !x.played && x.progressSeconds <= 0)),
  'card.genresComma': from('card', x => x.genres.join(', ')),
  'hero.label': from('hero', cardName),
  'hero.genresLine': from('hero', x => x.genres.slice(0, 3).join(', ')),
  'hero.metaLine': from('hero', x => joinMeta([x.yearLabel, ...x.genres.slice(0, 3), x.rating])),

  'row.id': c => c.row?.id ?? '',
  'row.name': c => c.row?.name ?? '',
  'row.presentation': c => c.row?.presentation ?? '',
  'row.hasMore': c => (c.row ? yes(c.row.nextCursor !== '') : ''),
  'row.nameLength': c => (c.row ? String(c.row.name.length) : ''),
  'row.landscape': c => (c.row ? yes(c.row.items.length > 0 && c.row.items.every(i => i.kind === 'episode' || (i.progressSeconds > 0 && !i.played))) : ''),
  'row.resume': c => (c.row ? yes(c.row.items.length > 0 && c.row.items.every(i => i.progressSeconds > 0 && !i.played)) : ''),
  'row.previewOnFocus': c => (c.row ? yes(c.row.previewOnFocus) : ''),
  // Recommendations presentation (Ether): how the row draws (standard|hero|wide|tiles|tracks; unknown
  // values read standard), its card (poster|landscape|square|round, or ''), the items' media role,
  // whether its titles are the viewer's own, its library and experience (watch|listen|read|gallery|live).
  'row.layout': c => c.row?.layout ?? '',
  'row.card': c => c.row?.card ?? '',
  'row.role': c => c.row?.role ?? '',
  'row.personal': c => (c.row ? yes(c.row.personal) : ''),
  'row.library': c => c.row?.library ?? '',
  'row.experience': c => c.row?.experience ?? '',
  'row.loadingMore': (c, e) => (c.row ? yes(e.rowLoading.includes(c.row.id)) : ''),
  'pager.overflows': pagerBinding((c: Ctx) => (c.row ? yes(!(pagerState(c.row.id)?.atStart ?? true) || !(pagerState(c.row.id)?.atEnd ?? true)) : '')),
  'pager.atStart': pagerBinding((c: Ctx) => (c.row ? yes(pagerState(c.row.id)?.atStart ?? true) : '')),
  'pager.atEnd': pagerBinding((c: Ctx) => (c.row ? yes(pagerState(c.row.id)?.atEnd ?? true) : '')),

  'heroAct.reasonLabel': c => c.heroAct?.reasonLabel ?? '',
  'heroAct.actionLabel': c => c.heroAct?.actionLabel ?? '',
  'heroAct.actionDetail': c => c.heroAct?.actionDetail ?? '',
  'heroAct.action': c => c.heroAct?.action ?? '',
  'heroAct.targetId': c => c.heroAct?.targetId ?? '',
  'heroAct.progressPct': c => (c.heroAct ? String(c.heroAct.progress * 100) : ''),
  'heroAct.hasProgress': c => (c.heroAct ? yes(c.heroAct.progress > 0) : ''),
  'heroAct.playable': c => (c.heroAct ? yes(c.heroAct.action !== 'details' && c.heroAct.targetId !== '') : ''),
  /** A featured title's pager label: its place among them, name and why it is featured. */
  'hero.slideLabel': (c, e) => (c.hero ? t('hero.slide', { index: String(c.index + 1), count: String(e.home?.hero.length ?? 0), name: c.hero.name, reason: c.heroAct?.reasonLabel ?? '' }) : ''),

  'dest.id': c => c.dest?.id ?? '',
  'dest.name': c => c.dest?.name ?? '',
  'dest.kind': c => c.dest?.kind ?? '',
  'dest.backdrop': c => c.dest?.backdrop ?? '',
  'dest.more': (c, e) => (c.dest ? yes(!e.navMeasuring && (e.navOut ?? []).includes(c.dest.id)) : ''),
  'nav.sectionName': (_, e) => {
    if (e.section === 'home') return t('ui.home');
    if (e.section === 'live') return t('ui.live');
    return e.libraries.find(library => library.id === e.section)?.name.trim() || t('ui.library');
  },
  'nav.more': (_, e) => yes(!!e.navMeasuring || (e.navOut?.length ?? 0) > 0),
  'nav.liveMore': (_, e) => yes(!e.navMeasuring && (e.navOut ?? []).includes('live')),
  'nav.moreOn': (_, e) => yes(!e.navMeasuring && (e.navOut ?? []).some(key => key === e.section
    || (e.section === 'live' && e.libraries.some(l => l.id === key && l.kind === 'live')))),
  'dest.on': (c, e) => (c.dest ? yes(c.dest.kind === 'live' ? e.section === 'live' : e.section === c.dest.id) : ''),
  'dest.seed': c => (c.dest ? String(c.dest.id.length) : ''),
  'dest.nameLength': c => (c.dest ? String(c.dest.name.length) : ''),

  'extra.id': c => c.extra?.id ?? '',
  'extra.name': c => c.extra?.name ?? '',
  'extra.kind': c => c.extra?.kind ?? '',
  'extra.ready': c => (c.extra ? yes(c.extra.ready) : ''),
  'extra.seed': c => (c.extra ? String(c.extra.id.length) : ''),
  'person.name': c => c.person?.name ?? '',
  'person.id': c => c.person?.id ?? '',
  'person.canOpen': c => yes(!!c.person?.canOpen),
  'person.role': c => c.person?.role ?? '',
  'person.portrait': c => c.person?.portrait ?? '',
  'person.initials': c => (c.person ? c.person.name.split(' ').slice(0, 2).map(w => w.slice(0, 1)).join('').toUpperCase() : ''),
  'person.seed': c => (c.person ? String(c.person.name.length) : ''),
  'person.nameLength': c => (c.person ? String(c.person.name.length) : ''),
  'fact.text': c => c.fact ?? '',
  'genre.text': c => c.fact ?? '',

  index: c => String(c.index),
  'index.label': c => String(c.index + 1),
  'index.current': (c, e) => yes(c.index === e.heroIndex),

  'season.on': (c, e) => (c.card ? yes(c.card.id === selectedSeason(e.detail, e.season)) : ''),
  'season.pick': c => (c.card ? `${c.card.id}|season|` : ''),
  'episode.numberTitle': c => (c.card ? (c.card.episodeNumber > 0 ? t('ui.numberTitle', { number: c.card.episodeNumberLabel, title: c.card.name }) : c.card.name) : ''),
  'episode.upNextLabel': c => (c.card ? t(c.card.progressSeconds > 0 ? 'ui.continueWatching' : 'ui.upNext') : ''),
  'episode.unreleased': from('card', x => yes(isUnreleased(x.airDate))),
  'episode.facts': from('card', x => releaseLabel(x.airDate) || joinMeta([x.facts])),
  'episode.playLabel': c => (c.card ? t(c.card.progressSeconds > 0 ? 'ui.resumeEpisode' : 'ui.playEpisode') : ''),

  'env.viewer': (_, e) => e.viewer,
  'env.viewerInitial': (_, e) => e.viewer.slice(0, 1).toUpperCase(),
  'env.viewerAvatar': (_, e) => e.viewerAvatar ?? '',
  'env.section': (_, e) => e.section,
  'env.query': (_, e) => e.query,
  'env.small': (_, e) => yes(e.small),
  'env.tv': (_, e) => yes(e.tv),
  'env.still': (_, e) => yes(e.still),
  'env.searching': (_, e) => yes(e.query !== ''),
  'env.searchFocused': (_, e) => yes(selectEnv(e, 'flags', 'flag:search-focused', flags => flags.includes('search-focused'))),
  'env.canLive': (_, e) => yes(e.canLive),
  'env.canPlaylists': (_, e) => yes(e.canPlaylists),
  'env.canSwitchProfile': (_, e) => yes(e.canSwitchProfile),
  'env.heroCount': (_, e) => (e.home ? String(e.home.hero.length) : ''),
  'env.heroIndex': (_, e) => String(e.heroIndex),
  'env.rowCount': (_, e) => (e.home ? String(e.home.rows.length) : ''),
  // As the app's rotation (hero-rotation.ts): a playing hero trailer holds the hero too.
  'env.rotating': (_, e) => (e.home ? yes(shouldRotateHero({ onHome: true, heroCount: e.home.hero.length, still: e.still,
    query: e.query, heroPreviewing: !!e.preview?.heroId, flags: e.flags })) : ''),
  'env.heroPaused': (_, e) => yes(selectEnv(e, 'flags', 'flag:hero-paused', flags => flags.includes('hero-paused'))),
  /** The featured titles before and after the one on show, wrapping round (pickHero's argument). */
  'env.heroPrev': (_, e) => (e.home?.hero.length ? String((e.heroIndex - 1 + e.home.hero.length) % e.home.hero.length) : ''),
  'env.heroNext': (_, e) => (e.home?.hero.length ? String((e.heroIndex + 1) % e.home.hero.length) : ''),
  'env.width': (_, e) => String(e.width),
  'env.skinCount': (_, e) => String(e.skinCount),
  'env.skinName': (_, e) => e.skinName,
  // Renderer 18: the About line a profile menu ends with, and the facts in it.
  'env.appVersion': (_, e) => e.about?.version ?? '',
  'env.appBuild': (_, e) => e.about?.build ?? '',
  'env.platform': (_, e) => e.about?.platform ?? '',
  'env.serverProduct': (_, e) => e.about?.server ?? '',
  'env.serverName': (_, e) => e.about?.serverName ?? '',
  'env.serverVersion': (_, e) => e.about?.serverVersion ?? '',
  'env.aboutLine': (_, e) => aboutLine(e.about),
  'env.aboutLabel': (_, e) => aboutLabel(e.about),
  'env.libraryCount': (_, e) => String(e.libraries.length),
  'env.homeMoreLoading': (_, e) => yes(e.homeLoading),
  'env.homeSlow': (_, e) => yes(e.homeSlow),
  'env.homeHasMore': (_, e) => (e.home ? yes(e.home.nextCursor !== '') : ''),
  'env.route': (_, e) => e.route,
  'env.load': (_, e) => e.load,
  'env.loadMessage': (_, e) => t(e.loadFailure === 'not-found'
    ? 'ui.titleNotFound'
    : e.loadFailure === 'temporary' ? 'ui.titleTemporarilyUnavailable' : 'ui.titleLoadFailed'),
  'env.canRetry': (_, e) => yes(e.load === 'failed' || e.library?.viewLoad === 'failed'),
  'env.entry': (_, e) => e.entry,

  ...Object.fromEntries(DETAIL_FIELDS.map(f => [`detail.${f}`, title(x => String(x[f]))])),
  // `detail.id` is the primary playback target. On a series page that is an episode, while
  // kindId and the action widgets continue to use the series title itself.
  'detail.id': detail(d => detailPlaybackCard(d)?.id ?? d.title[0]?.id ?? ''),
  'detail.showName': title(x => x.showName),
  'detail.episodeContext': title(x => joinMeta([x.episodeContext])),
  'detail.yearLabel': title(x => x.yearLabel),
  'detail.year': title(x => String(x.year)),
  'detail.rating': title(x => x.rating),
  'detail.played': title(x => yes(x.played)),
  'detail.durationLabel': title(x => x.durationLabel),
  'detail.hasProgress': title(x => yes(hasProgress(x))),
  'detail.progressPct': title(x => pct(x.progressSeconds, x.durationSeconds), '0'),
  'detail.seasonNumberLabel': title(x => x.seasonNumberLabel),
  'detail.episodeNumberLabel': title(x => x.episodeNumberLabel),
  'detail.episodeNumber': title(x => String(x.episodeNumber)),
  'detail.genresLine': title(x => x.genres.join(', ')),
  'detail.nameLength': title(x => String(x.name.length)),
  'detail.seed': title(x => String(x.id.length)),
  'detail.kindLabel': title(kindLabel),
  'detail.kindId': title(kindId),
  'detail.facts': title(x => joinMeta([x.facts])),
  'detail.factsLine': title((card, detail) => {
    const next = detail.nextUp?.[0] ?? detail.episodes.find(episode => !episode.played);
    const release = releaseLabel(card.airDate) || (!detail.canPlay ? releaseLabel(next?.airDate) : '');
    return joinMeta([release, factsLine(card)]);
  }),
  'detail.resumePct': detail(d => {
    const card = detailPlaybackCard(d);
    return card ? pct(card.progressSeconds, card.durationSeconds) : '0';
  }, '0'),
  'detail.resumePosition': detail(d => d.resumePosition),
  'detail.seasonCount': detail(d => String(d.seasons.length), '0'),
  'detail.seasonName': detail((d, e) => d.seasons.filter(x => x.id === selectedSeason(d, e.season)).map(x => x.name).join('')),
  'detail.seasonPending': detail((d, e) => yes(selectedSeason(d, e.season) !== '' && d.episodes.length > 0 && !d.episodes.some(x => x.seasonId === selectedSeason(d, e.season))), 'false'),
  // A queued section only waits while absent; a partial refresh keeps available content visible.
  'detail.seasonsPending': detail(d => yes(d.pending.includes('seasons') && d.seasons.length === 0), 'false'),
  'detail.episodesPending': detail(d => yes(d.pending.includes('episodes') && d.episodes.length === 0), 'false'),
  'detail.extrasPending': detail(d => yes(d.pending.includes('extras') && d.extras.length === 0), 'false'),
  'detail.trailerPending': detail(d => yes(d.pending.includes('trailer') && d.trailerId === ''), 'false'),
  'detail.crewLineComma': detail(d => d.crew.join(', ')),
  'detail.crewLine': detail(d => joinMeta(d.crew)),
  'detail.trailerId': detail(d => d.trailerId),
  'detail.trailerReady': detail(d => yes(d.trailerId !== '' && d.trailerReady), 'false'),
  'detail.castLine': detail(d => joinMeta(d.cast)),
  'detail.canPlay': detail(d => yes(!!detailPlaybackCard(d)), 'false'),
  'detail.playLabel': detail(d => {
    const card = detailPlaybackCard(d);
    if (!card) return t('ui.play');
    if (card.kind === 'episode' && card.seasonNumber > 0 && card.episodeNumber > 0) {
      return t(`hero.action.${hasProgress(card) ? 'resumeEpisode' : 'playEpisode'}`, {
        season: card.seasonNumberLabel,
        episode: card.episodeNumberLabel,
      });
    }
    if (!d.canPlay || d.resumeSeconds <= 0) return t('ui.play');
    const length = d.title[0]?.durationSeconds ?? 0;
    // The same wording as Home's hero: what is left, not where the position is.
    return length > d.resumeSeconds ? t('ui.resumeTimeLeft', { time: duration(length - d.resumeSeconds) }) : t('ui.resumePositionIn', { position: d.resumePosition });
  }),
  'detail.hasResume': detail(d => yes(!!detailPlaybackCard(d) && hasProgress(detailPlaybackCard(d)!)), 'false'),
  'detail.hasSeasons': detail(d => yes(d.seasons.length > 1), 'false'),
  'detail.hasEpisodes': detail(d => yes(d.episodes.length > 0 || d.seasons.length > 0), 'false'),
  'detail.hasCast': detail(d => yes(d.castPeople.length > 0), 'false'),
  'detail.hasExtras': detail(d => yes(d.extras.length > 0), 'false'),
  'detail.hasMediaFacts': detail(d => yes(d.mediaFacts.length > 0), 'false'),
  'detail.hasRelated': detail(d => yes(d.related.length > 0), 'false'),
  'detail.selectedSeason': (_, e) => selectedSeason(e.detail, e.season),
  ...SEARCH_VOCABULARY,
  ...AUTH_VOCABULARY,
  ...PREVIEW_VOCABULARY,
  ...LIVE_VOCABULARY,
  ...LIBRARY_VOCABULARY,
};

/** A key's accessor, or undefined for a key no document may name. */
export function accessor(key: string): Accessor | undefined {
  return VOCABULARY[key];
}

/** The items a `repeat` draws, each with the context it extends. */
export function collection(over: string, c: Ctx, e: Env, limit: number): Ctx[] {
  const at = <T,>(list: readonly T[], make: (x: T, i: number) => Omit<Ctx, 'index'>) =>
    list.slice(0, limit).map((x, i) => ({ ...c, ...make(x, i), index: i }));
  const heroAct = (id: string) => e.home?.heroActions.find(a => a.heroId === id);
  const d = e.detail;
  const search = searchCollection(over, c, e, limit);
  if (search) return search;
  if (over === 'quick.chars') return quickChars(c, e, limit);
  const channels = liveCollection(over, c, e, limit);
  if (channels) return channels;
  const browsed = libraryCollection(over, c, e, limit);
  if (browsed) return browsed;
  switch (over) {
    case 'personPage.movies': return at((e.personPage?.items ?? []).filter(card => card.kind === 'movie'), card => ({ card }));
    case 'personPage.tv': return at((e.personPage?.items ?? []).filter(card => card.kind !== 'movie'), card => ({ card }));
    case 'detail.contextParts': return at(d?.title[0]?.contextParts ?? [], contextPart => ({ contextPart }));
    case 'card.contextParts': return at(c.card?.contextParts ?? [], contextPart => ({ contextPart }));
    case 'home.rows': {
      const rows = e.home?.rows ?? [];
      // A row re-read with a new id draws as it was (drawnAs): only what changed in it draws again.
      const keys = identityKeys(rows.map(drawnAs));
      return at(rows, (row, i) => ({ row, key: `row:${keys[i]}` }));
    }
    case 'row.items': {
      const items = c.row?.items ?? [];
      const keys = identityKeys(items.map(card => card.id));
      return at(items, (card, i) => ({ card, key: `card:${keys[i]}` }));
    }
    case 'home.heroes': return at(e.home?.hero ?? [], hero => ({ hero, heroAct: heroAct(hero.id) }));
    case 'home.hero': {
      const hero = e.home?.hero[e.heroIndex];
      return hero ? [{ ...c, hero, heroAct: heroAct(hero.id), index: e.heroIndex }] : [];
    }
    case 'nav.destinations': return at(e.libraries, dest => ({ dest }));
    case 'hero.genres': return at(c.hero?.genres ?? [], fact => ({ fact }));
    case 'detail.seasons': return at(d?.seasons ?? [], card => ({ card, seasonLabel: seasonDisplayName(card) }));
    case 'detail.episodes': return at(seasonEpisodes(d, e.season), card => ({ card }));
    case 'detail.upNext': return at(d?.nextUp ?? seasonEpisodes(d, e.season).filter(x => !x.played).slice(0, 1), card => ({ card }));
    case 'detail.extras': return at(d?.extras ?? [], extra => ({ extra }));
    case 'detail.trailers': return at((d?.extras ?? []).filter(x => x.kind === 'trailer' && x.ready), extra => ({ extra }));
    case 'detail.cast': return at(d?.castPeople ?? [], person => ({ person }));
    case 'detail.crew': return at(d?.crewPeople ?? [], person => ({ person }));
    case 'detail.mediaFacts': return at(d?.mediaFacts ?? [], fact => ({ fact }));
    case 'detail.genres': return at(d?.title[0]?.genres ?? [], fact => ({ fact }));
    case 'detail.related': return at(d?.related ?? [], row => ({ row: row as Row }));
    default:
      return [];
  }
}

/** Shelves keyed by what they hold: a Continue row that moves a title to the front, or a progress
 * shelf added above others, moves the drawn cards and rows instead of redrawing them in place. */
const IDENTITY = new Set(['home.rows', 'row.items', 'library.rows', 'search.sections', 'search.sectionResults']);

/** A stable key for a repeated item: its position and the id of the item it binds; for shelves and
 * their cards, their identity. */
export function itemKey(c: Ctx, over?: string): string {
  if (over === 'detail.episodes' && c.card) return c.card.id;
  if (over && IDENTITY.has(over) && c.key) return c.key;
  const item = Object.values(c).find((v): v is { id: string } => typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string');
  return `${c.index}:${item?.id ?? (typeof c.fact === 'string' ? c.fact : '')}`;
}
