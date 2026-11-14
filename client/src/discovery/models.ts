import type { ArtworkRef, Bootstrap, RowEntry, Title, TitleDetail } from '../../wire/v0/types';
import { artworkURL } from './artwork';

function art(artwork: ArtworkRef[], kind: ArtworkRef['kind'], width: number, height: number, origin?: string): string {
  const ref = artwork.find(item => item.kind === kind);
  return ref ? artworkURL(ref, width, height, origin) ?? '' : '';
}
export function card(title: Title, receipt = '', origin?: string) {
  return { id: title.id, kind: title.kind, name: title.name, summary: title.summary, year: title.year ?? 0, rating: title.rating ?? '', durationSeconds: title.durationSeconds ?? 0, progressSeconds: title.watch?.positionSeconds ?? 0, genres: title.genres,
    facts: [title.year, title.rating, title.durationSeconds ? `${Math.round(title.durationSeconds / 60)} min` : undefined].filter(x => x !== undefined).join(' · '),
    poster: art(title.artwork, 'poster', 400, 600, origin), backdrop: art(title.artwork, 'backdrop', 1280, 720, origin),
    logo: art(title.artwork, 'logo', 400, 200, origin), accent: title.artwork.find(a => a.color)?.color ?? '', receipt };
}
export function entry(item: RowEntry, origin?: string) {
  if (item.kind === 'title') return card(item.title, item.receiptToken, origin);
  const artwork = item.kind === 'channel' ? item.channel.artwork : item.artwork;
  return { id: item.kind === 'channel' ? item.channel.id : item.targetId, kind: item.kind,
    name: item.kind === 'channel' ? item.channel.name : item.name, summary: '', facts: '', year: 0, rating: item.kind === 'channel' ? item.channel.rating ?? '' : '', durationSeconds: 0, progressSeconds: 0, genres: [] as string[],
    poster: art(artwork, 'poster', 400, 600, origin), backdrop: art(artwork, 'backdrop', 1280, 720, origin),
    logo: art(artwork, 'logo', 400, 200, origin), accent: artwork.find(a => a.color)?.color ?? '', receipt: item.receiptToken };
}
export function homeModel(data: Bootstrap, origin?: string) {
  return { viewer: data.viewer.name, defaultSkinId: data.defaultSkinId, skins: data.capabilities.skins.map(s => s.id),
    hero: data.hero ? [card(data.hero.title, data.hero.receiptToken, origin)] : [],
    rows: data.rows.map(row => ({ id: row.id, name: row.name, receipt: row.receiptToken, items: row.items.map(item => entry(item, origin)) })),
    liveAvailable: data.capabilities.features.liveTV.available, aiAvailable: data.capabilities.features.aiSearch.available, descriptiveAvailable: data.capabilities.features.descriptiveSearch.available };
}
export function detailModel(data: TitleDetail, origin?: string) {
  return { title: [card(data.title, '', origin)], related: [], mediaFacts: [], canPlay: data.canPlay ?? false, resumeSeconds: data.title.watch?.positionSeconds ?? 0,
    seasons: (data.seasons ?? []).map(t => card(t, '', origin)), episodes: (data.episodes ?? []).map(t => card(t, '', origin)),
    extras: data.extras.map(e => ({ id: e.id, name: e.name, kind: e.kind, ready: e.availability === 'ready' })),
    cast: data.cast.map(c => c.role ? `${c.name} · ${c.role}` : c.name) };
}
