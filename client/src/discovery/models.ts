import type { ArtworkRef, Bootstrap, RowEntry, Title, TitleDetail } from '../../../protocol/v0/types';
import { artworkURL } from './artwork';

function art(artwork: ArtworkRef[], kind: ArtworkRef['kind'], width: number, height: number): string {
  const ref = artwork.find(item => item.kind === kind);
  return ref ? artworkURL(ref, width, height) ?? '' : '';
}
export function card(title: Title, receipt = '') {
  return { id: title.id, kind: title.kind, name: title.name, summary: title.summary,
    facts: [title.year, title.rating, title.durationSeconds ? `${Math.round(title.durationSeconds / 60)} min` : undefined].filter(x => x !== undefined).join(' · '),
    poster: art(title.artwork, 'poster', 400, 600), backdrop: art(title.artwork, 'backdrop', 1280, 720),
    logo: art(title.artwork, 'logo', 400, 200), accent: title.artwork.find(a => a.color)?.color ?? '', receipt };
}
function entry(item: RowEntry) {
  if (item.kind === 'title') return card(item.title, item.receiptToken);
  const artwork = item.kind === 'channel' ? item.channel.artwork : item.artwork;
  return { id: item.kind === 'channel' ? item.channel.id : item.targetId, kind: item.kind,
    name: item.kind === 'channel' ? item.channel.name : item.name, summary: '', facts: '',
    poster: art(artwork, 'poster', 400, 600), backdrop: art(artwork, 'backdrop', 1280, 720),
    logo: art(artwork, 'logo', 400, 200), accent: artwork.find(a => a.color)?.color ?? '', receipt: item.receiptToken };
}
export function homeModel(data: Bootstrap) {
  return { viewer: data.viewer.name, defaultSkinId: data.defaultSkinId, skins: data.capabilities.skins.map(s => s.id),
    hero: data.hero ? [card(data.hero.title, data.hero.receiptToken)] : [],
    rows: data.rows.map(row => ({ id: row.id, name: row.name, receipt: row.receiptToken, items: row.items.map(entry) })),
    aiAvailable: data.capabilities.features.aiSearch.available, descriptiveAvailable: data.capabilities.features.descriptiveSearch.available };
}
export function detailModel(data: TitleDetail) {
  return { title: [card(data.title)], canPlay: data.canPlay ?? false, resumeSeconds: data.title.watch?.positionSeconds ?? 0,
    seasons: (data.seasons ?? []).map(t => card(t)), episodes: (data.episodes ?? []).map(t => card(t)),
    extras: data.extras.map(e => ({ id: e.id, name: e.name, kind: e.kind, ready: e.availability === 'ready' })),
    cast: data.cast.map(c => c.role ? `${c.name} · ${c.role}` : c.name) };
}
