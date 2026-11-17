// The binding vocabulary (docs/skin-schema.md): every key a document may read, as an accessor
// over the binding context (the repeated item a node sits in) and the environment (the app's
// view state). The semantics are those of the Contract renderer's table (tools/renderer.ts),
// key for key. A template calls only the accessors it names.
import { msg } from '@vela/core';
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
  section: string;
  query: string;
  small: boolean;
  tv: boolean;
  still: boolean;
  canLive: boolean;
  width: number;
  home?: HomeModel;
  heroIndex: number;
  libraries: Destination[];
  skinCount: number;
  skinName: string;
  homeLoading: boolean;
  detail?: DetailModel;
  season: string;
  route: string;
  load: 'loading' | 'failed' | 'ready';
  entry: string;
  flags: string[];
  rowLoading: string[];
  /** Per row: whether its pager is at its start and end. */
  pagers: Record<string, { atStart: boolean; atEnd: boolean }>;
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
  personPage?: { name: string; portrait: string; role: string; biography?: string; birthday?: string; items: Card[]; more: boolean; loading: boolean };
}

/** The binding context: the item a node is repeated over, and its position. */
export interface Ctx {
  contextPart?: Card['contextParts'][number];
  card?: Card;
  hero?: Card;
  heroAct?: HeroAction;
  row?: Row;
  dest?: Destination;
  extra?: Extra;
  person?: Person;
  fact?: string;
  hit?: Hit;
  /** A channel of live.channels or live.favorites. */
  ch?: GuideChannel;
  /** A kind, genre or sort of library.kinds, library.genres or library.sorts. */
  opt?: LibraryOption;
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
const factsLine = (x: Card) => [x.facts, ...x.genres.slice(0, 3)].filter(f => f !== '').join(' · ');
const kindId = (x: Card) => `${x.id}|${x.kind}|${x.receipt}`;
/** All skins read the same season scope; a stale selection from another title falls back. */
function selectedSeason(d: DetailModel | undefined, season: string): string {
  return d?.seasons.some(s => s.id === season) ? season : d?.seasons[0]?.id ?? '';
}
function seasonEpisodes(d: DetailModel | undefined, season: string): Card[] {
  const selected = selectedSeason(d, season);
  return (d?.episodes ?? []).filter(card => !selected || card.seasonId === selected);
}
const hasProgress = (x: Card) => x.progressSeconds > 0 && x.durationSeconds > 0 && !x.played;

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

const CARD_FIELDS = ['id', 'kind', 'name', 'summary', 'facts', 'yearLabel', 'rating', 'progressLabel', 'poster', 'backdrop', 'logo', 'accent', 'receipt'] as const;
const DETAIL_FIELDS = ['id', 'kind', 'name', 'summary', 'facts', 'poster', 'backdrop', 'logo', 'accent', 'receipt'] as const;

export const VOCABULARY: Record<string, Accessor> = {
  'personPage.name': (_, e) => e.personPage?.name ?? '',
  'personPage.portrait': (_, e) => e.personPage?.portrait ?? '',
  'personPage.role': (_, e) => e.personPage?.role ?? '',
  'personPage.biography': (_, e) => e.personPage?.biography ?? '',
  'personPage.birthday': (_, e) => e.personPage?.birthday ?? '',
  'personPage.initials': (_, e) => (e.personPage?.name ?? '').split(' ').slice(0, 2).map(w => w.slice(0, 1)).join('').toUpperCase(),
  'personPage.empty': (_, e) => yes(!e.personPage?.items.length && !e.personPage?.loading),
  'personPage.emptyText': (_, e) => t('person.empty', { name: e.personPage?.name ?? '' }),
  'personPage.moviesCount': (_, e) => String(e.personPage?.items.filter(c => c.kind === 'movie').length ?? 0),
  'personPage.tvCount': (_, e) => String(e.personPage?.items.filter(c => c.kind !== 'movie').length ?? 0),
  'personPage.more': (_, e) => yes(!!e.personPage?.more),
  'personPage.loading': (_, e) => yes(!!e.personPage?.loading),
  'context.label': c => c.contextPart?.label ?? '',
  'context.select': c => c.contextPart?.select ?? '',
  'card.hasContext': from('card', x => yes(x.contextParts.length > 0)),
  ...Object.fromEntries(CARD_FIELDS.flatMap(f => [[`card.${f}`, from('card', x => String(x[f]))], [`hero.${f}`, from('hero', x => String(x[f]))]])),
  'card.played': from('card', x => yes(x.played)),
  'card.episodeNumberLabel': from('card', x => x.episodeNumberLabel),
  'card.durationLabel': from('card', x => x.durationLabel),
  'card.progressPct': from('card', x => pct(x.progressSeconds, x.durationSeconds)),
  'card.hasProgress': from('card', x => yes(hasProgress(x))),
  'card.label': from('card', cardName),
  'card.kindId': from('card', kindId),
  'hero.kindId': from('hero', kindId),
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
  'hero.metaLine': from('hero', x => [x.yearLabel, ...x.genres.slice(0, 3), x.rating].filter(f => f !== '').join(' · ')),

  'row.id': c => c.row?.id ?? '',
  'row.name': c => c.row?.name ?? '',
  'row.presentation': c => c.row?.presentation ?? '',
  'row.hasMore': c => (c.row ? yes(c.row.nextCursor !== '') : ''),
  'row.nameLength': c => (c.row ? String(c.row.name.length) : ''),
  'row.landscape': c => (c.row ? yes(c.row.items.length > 0 && c.row.items.every(i => i.kind === 'episode' || (i.progressSeconds > 0 && !i.played))) : ''),
  'row.resume': c => (c.row ? yes(c.row.items.length > 0 && c.row.items.every(i => i.progressSeconds > 0 && !i.played)) : ''),
  'row.previewOnFocus': c => (c.row ? yes(c.row.previewOnFocus) : ''),
  'row.loadingMore': (c, e) => (c.row ? yes(e.rowLoading.includes(c.row.id)) : ''),
  'pager.overflows': (c, e) => (c.row ? yes(!(e.pagers[c.row.id]?.atStart ?? true) || !(e.pagers[c.row.id]?.atEnd ?? true)) : ''),
  'pager.atStart': (c, e) => (c.row ? yes(e.pagers[c.row.id]?.atStart ?? true) : ''),
  'pager.atEnd': (c, e) => (c.row ? yes(e.pagers[c.row.id]?.atEnd ?? true) : ''),

  'heroAct.reasonLabel': c => c.heroAct?.reasonLabel ?? '',
  'heroAct.actionLabel': c => c.heroAct?.actionLabel ?? '',
  'heroAct.actionDetail': c => c.heroAct?.actionDetail ?? '',
  'heroAct.action': c => c.heroAct?.action ?? '',
  'heroAct.targetId': c => c.heroAct?.targetId ?? '',
  'heroAct.progressPct': c => (c.heroAct ? String(c.heroAct.progress * 100) : ''),
  'heroAct.hasProgress': c => (c.heroAct ? yes(c.heroAct.progress > 0) : ''),
  'heroAct.playable': c => (c.heroAct ? yes(c.heroAct.action !== 'details' && c.heroAct.targetId !== '') : ''),

  'dest.id': c => c.dest?.id ?? '',
  'dest.name': c => c.dest?.name ?? '',
  'dest.kind': c => c.dest?.kind ?? '',
  'dest.backdrop': c => c.dest?.backdrop ?? '',
  'dest.on': (c, e) => (c.dest ? yes(c.dest.kind === 'live' ? e.section === 'live' : e.section === c.dest.id) : ''),
  'dest.seed': c => (c.dest ? String(c.dest.id.length) : ''),
  'dest.nameLength': c => (c.dest ? String(c.dest.name.length) : ''),

  'extra.id': c => c.extra?.id ?? '',
  'extra.name': c => c.extra?.name ?? '',
  'extra.kind': c => c.extra?.kind ?? '',
  'extra.ready': c => (c.extra ? yes(c.extra.ready) : ''),
  'extra.seed': c => (c.extra ? String(c.extra.id.length) : ''),
  'person.name': c => c.person?.name ?? '',
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
  'episode.playLabel': c => (c.card ? t(c.card.progressSeconds > 0 ? 'ui.resumeEpisode' : 'ui.playEpisode') : ''),

  'env.viewer': (_, e) => e.viewer,
  'env.viewerInitial': (_, e) => e.viewer.slice(0, 1).toUpperCase(),
  'env.section': (_, e) => e.section,
  'env.query': (_, e) => e.query,
  'env.small': (_, e) => yes(e.small),
  'env.tv': (_, e) => yes(e.tv),
  'env.still': (_, e) => yes(e.still),
  'env.searching': (_, e) => yes(e.query !== ''),
  'env.searchFocused': (_, e) => yes(e.flags.includes('search-focused')),
  'env.canLive': (_, e) => yes(e.canLive),
  'env.heroCount': (_, e) => (e.home ? String(e.home.hero.length) : ''),
  'env.heroIndex': (_, e) => String(e.heroIndex),
  'env.rowCount': (_, e) => (e.home ? String(e.home.rows.length) : ''),
  'env.rotating': (_, e) => (e.home ? yes(e.home.hero.length > 1 && !e.still && e.query === '') : ''),
  'env.width': (_, e) => String(e.width),
  'env.skinCount': (_, e) => String(e.skinCount),
  'env.skinName': (_, e) => e.skinName,
  'env.libraryCount': (_, e) => String(e.libraries.length),
  'env.homeMoreLoading': (_, e) => yes(e.homeLoading),
  'env.homeHasMore': (_, e) => (e.home ? yes(e.home.nextCursor !== '') : ''),
  'env.route': (_, e) => e.route,
  'env.load': (_, e) => e.load,
  'env.canRetry': (_, e) => yes(e.load === 'failed'),
  'env.entry': (_, e) => e.entry,

  ...Object.fromEntries(DETAIL_FIELDS.map(f => [`detail.${f}`, title(x => String(x[f]))])),
  'detail.showName': title(x => x.showName),
  'detail.episodeContext': title(x => x.episodeContext),
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
  'detail.kindLabel': title(x => t(x.kind === 'movie' ? 'ui.film' : x.kind === 'show' ? 'ui.series' : x.kind === 'season' ? 'ui.season' : 'ui.episode')),
  'detail.kindId': title(kindId),
  'detail.factsLine': title(factsLine),
  'detail.resumePct': title((x, d) => pct(d.resumeSeconds, x.durationSeconds), '0'),
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
  'detail.crewLine': detail(d => d.crew.join(' · ')),
  'detail.trailerId': detail(d => d.trailerId),
  'detail.trailerReady': detail(d => yes(d.trailerId !== '' && d.trailerReady), 'false'),
  'detail.castLine': detail(d => d.cast.join(' · ')),
  'detail.canPlay': detail(d => yes(d.canPlay), 'false'),
  'detail.playLabel': detail(d => (d.resumeSeconds > 0 ? t('ui.resumePositionIn', { position: d.resumePosition }) : t('ui.play'))),
  'detail.hasResume': detail(d => yes(d.canPlay && d.resumeSeconds > 0), 'false'),
  'detail.hasSeasons': detail(d => yes(d.seasons.length > 1), 'false'),
  'detail.hasEpisodes': detail(d => yes(d.episodes.length > 0), 'false'),
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
    case 'home.rows': return at(e.home?.rows ?? [], row => ({ row }));
    case 'row.items': return at(c.row?.items ?? [], card => ({ card }));
    case 'home.heroes': return at(e.home?.hero ?? [], hero => ({ hero, heroAct: heroAct(hero.id) }));
    case 'home.hero': {
      const hero = e.home?.hero[e.heroIndex];
      return hero ? [{ ...c, hero, heroAct: heroAct(hero.id), index: e.heroIndex }] : [];
    }
    case 'nav.destinations': return at(e.libraries, dest => ({ dest }));
    case 'hero.genres': return at(c.hero?.genres ?? [], fact => ({ fact }));
    case 'detail.seasons': return at(d?.seasons ?? [], card => ({ card }));
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

/** A stable key for a repeated item: its position and the id of the item it binds. */
export function itemKey(c: Ctx): string {
  const item = Object.values(c).find((v): v is { id: string } => typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string');
  return `${c.index}:${item?.id ?? (typeof c.fact === 'string' ? c.fact : '')}`;
}
