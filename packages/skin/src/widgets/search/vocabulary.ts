// Search's vocabulary (docs/skin-schema.md): the lanes' states and sizes, a live hit's fields,
// and the collections routes.search repeats over. The semantics are those of the Contract
// renderer's table (tools/renderer.ts at afc4578), key for key.
import { msg } from '@vela/core';
import type { Accessor, Ctx, Env } from '../../vocabulary';
import type { Hit, LiveChannelHit, LiveProgrammeHit, SearchView } from './model';

export const searchOption = (value: string | { id: string; label?: string }) => {
  const id = typeof value === 'string' ? value : value.id;
  return { id, label: (typeof value === 'string' ? undefined : value.label) ?? id.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) };
};

const yes = (value: boolean) => (value ? 'true' : 'false');

/** A key over the open query's search view; nothing while no query is open. */
function over(read: (s: SearchView) => string): Accessor {
  return (_, e) => (e.search ? read(e.search) : '');
}

/** A key over the live hit in context: one reader for a channel, one for a programme. */
function hit(channel: (x: LiveChannelHit) => string, programme: (x: LiveProgrammeHit) => string): Accessor {
  return c => {
    if (!c.hit) return '';
    return c.hit.kind === 'channel' ? channel(c.hit.channel) : programme(c.hit.programme);
  };
}

const ready = (s: SearchView) => s.titles.state === 'ready';
const airing = (s: SearchView) => (ready(s) ? s.titles.programmes.filter(p => p.airing) : []);
const upcoming = (s: SearchView) => (ready(s) ? s.titles.programmes.filter(p => !p.airing) : []);
const channels = (s: SearchView) => (ready(s) ? s.titles.channels : []);
const titles = (s: SearchView) => (ready(s) ? s.titles.items : []);
/** A failed descriptive answer keeps whatever candidates it found. */
const descriptive = (s: SearchView) =>
  s.descriptive.state === 'ready' || s.descriptive.state === 'failed' ? s.descriptive.items : [];
const discovered = (s: SearchView) => (s.ai.state === 'off' ? [] : s.ai.items);

/** Several words read as a description, not a name: an empty answer is then about the mood. */
const describing = (s: SearchView) =>
  s.query.trim().split(' ').filter(w => w !== '').length > 1 && s.descriptive.state !== 'off';

/** A programme's channel line: its episode, then the channel. */
const programmeLine = (x: LiveProgrammeHit) => (x.episode !== '' ? `${x.episode} · ${x.channelName}` : x.channelName);

export const SEARCH_VOCABULARY: Record<string, Accessor> = {
  'search.libraryCount': (_, e) => String(e.search?.controls?.searchLibraries ? e.libraries?.length ?? 0 : 0),
  'search.library': over(s => s.controls?.library ?? ''),
  'search.sortCount': over(s => String(s.controls?.searchSorts?.length ?? 0)),
  'search.kindCount': over(s => String(s.controls?.searchKinds?.length ?? 0)),
  'search.kindOn': (c, e) => yes((c.opt?.id ?? '') === (e.search?.controls?.kind ?? '')),
  'search.sort': over(s => s.controls?.sort ?? ''),
  'search.direction': over(s => s.controls?.direction ?? ''),
  'search.kind': over(s => s.controls?.kind ?? ''),
  // A kind or library restriction is on: an empty answer is about the filters, not the words.
  'search.filtered': over(s => yes(!!s.controls?.kind || !!s.controls?.library)),
  'search.directionCount': over(s => String(s.controls?.searchSorts?.find(x => x.id === s.controls?.sort)?.directions.length ?? 0)),
  'search.moreFast': over(s => yes(!!s.more?.fast)),
  'search.moreDescriptive': over(s => yes(!!s.more?.descriptive)),
  // With no query open the title lane reads ready and empty.
  'env.search': (_, e) => e.search?.titles.state ?? 'ready',
  'search.titleCount': over(s => String(titles(s).length)),
  'search.describing': over(s => yes(describing(s))),
  'search.descriptiveState': over(s => s.descriptive.state),
  'search.descriptiveCount': over(s => String(descriptive(s).length)),
  'search.canRetry': over(s => yes(s.descriptive.state === 'failed' && s.descriptive.canRetry)),
  'search.aiState': over(s => s.ai.state),
  'search.aiCount': over(s => String(discovered(s).length)),
  'search.onNowCount': over(s => String(channels(s).length + airing(s).length)),
  'search.comingUpCount': over(s => String(upcoming(s).length)),

  'hit.id': hit(x => x.id, x => x.id),
  'hit.kind': c => c.hit?.kind ?? '',
  'hit.ref': hit(x => `channel|${x.id}`, x => `programme|${x.id}`),
  'hit.name': hit(x => (x.nowTitle !== '' ? x.nowTitle : x.name), x => x.name),
  'hit.channelName': hit(x => x.name, x => x.channelName),
  'hit.channelNumber': hit(x => x.number, () => ''),
  'hit.logo': hit(x => x.logo, x => x.channelLogo),
  'hit.artwork': hit(() => '', x => x.artwork),
  'hit.episode': hit(() => '', x => x.episode),
  'hit.live': hit(x => yes(x.nowTitle !== ''), x => yes(x.airing)),
  'hit.progressPct': hit(x => String(x.nowProgress * 100), x => String(x.progress * 100)),
  'hit.detail': hit(
    x => (x.nowEndLabel !== ''
      ? msg('search.live.until', { channel: x.name, time: x.nowEndLabel })
      : msg('search.live.channel', { number: x.number })),
    x => (x.airing ? msg('search.live.until', { channel: programmeLine(x), time: x.endLabel }) : programmeLine(x)),
  ),
  'hit.chip': hit(() => '', x => (x.airing ? '' : x.startsInLabel !== '' ? x.startsInLabel : x.startLabel)),
  'hit.navigable': hit(() => 'true', x => yes(x.navigable)),
};

/** The items a `repeat` over a search collection draws, or undefined for any other collection. */
export function searchCollection(over: string, c: Ctx, e: Env, limit: number): Ctx[] | undefined {
  if (!over.startsWith('search.')) return undefined;
  const s = e.search;
  if (!s) return [];
  const cards = (list: Ctx['card'][]) => list.slice(0, limit).map((card, index) => ({ ...c, card, index }));
  const hits = (list: Hit[]) => list.slice(0, limit).map((h, index) => ({ ...c, hit: h, index }));
  const programme = (p: LiveProgrammeHit): Hit => ({ kind: 'programme', programme: p });
  switch (over) {
    case 'search.libraries': return (s.controls?.searchLibraries ? [{ id: '', label: 'All libraries' }, ...(e.libraries ?? []).map(l => ({ id: l.id, label: l.name }))] : []).map((opt, index) => ({ ...c, index, opt: { ...opt, of: 'kind' as const } }));
    case 'search.kinds': return [{ id: '', label: 'All' }, ...(s.controls?.searchKinds ?? []).map(searchOption)].map((opt, index) => ({ ...c, index, opt: { ...opt, of: 'kind' as const } }));
    case 'search.sorts': return (s.controls?.searchSorts ?? []).map(searchOption).map((opt, index) => ({ ...c, index, opt: { ...opt, of: 'sort' as const } }));
    case 'search.directions': return (s.controls?.searchSorts?.find(x => x.id === s.controls?.sort)?.directions ?? []).map((id, index) => ({ ...c, index, opt: { of: 'sort' as const, id, label: id === 'asc' ? 'Ascending' : 'Descending' } }));
    case 'search.titles': return cards(titles(s));
    case 'search.descriptive': return cards(descriptive(s));
    case 'search.ai': return cards(discovered(s));
    case 'search.onNow': return hits([
      ...channels(s).map((channel): Hit => ({ kind: 'channel', channel })),
      ...airing(s).map(programme),
    ]);
    case 'search.comingUp': return hits(upcoming(s).map(programme));
    default: return [];
  }
}
