import type * as V from '../wire';

const identity = (title: V.Title) => title.showId || title.id;
/** Feature the server's own ordered resume, next-up, recent and promoted candidates. */
export function homeHeroes(rows: V.Row[], provider: string, resize: (url: string, width: number, height: number) => string) {
  const heroes: V.Hero[] = [], seen = new Set<string>();
  const add = (entry: V.RowEntry, reason: V.HeroReason) => {
    if (entry.kind !== 'title' || !['movie', 'episode', 'show'].includes(entry.title.kind)) return;
    const title = entry.title;
    if (heroes.length === 6 || seen.has(identity(title)) || !title.artwork.some(a => a.kind === 'backdrop' && a.sizes.some(s => s.url))) return;
    seen.add(identity(title));
    const artwork: V.ArtworkRef[] = [];
    for (const [kind, width, height] of [['backdrop', 1920, 1080], ['logo', 800, 320], ['poster', 600, 900]] as const) {
      const ref = title.artwork.find(a => a.kind === kind && a.sizes.some(s => s.url));
      const image = ref?.sizes.find(s => s.url);
      if (ref && image) artwork.push({ ...ref, sizes: [{ width, height, url: resize(image.url, width, height) }] });
    }
    const action: V.HeroAction = reason === 'resume' ? { kind: 'resume', titleId: title.id, positionSeconds: title.watch?.positionSeconds ?? 0 }
      : { kind: title.kind === 'show' ? 'details' : 'play', titleId: title.id };
    heroes.push({ title: { ...title, artwork }, receiptToken: `${provider}:hero:${reason}:${title.id}`, reason, action });
  };
  const continuing = rows.filter(r => r.purpose === 'continue' || r.purpose === 'nextUp');
  for (const row of continuing) for (const item of row.items) if (item.kind === 'title' && (item.title.watch?.positionSeconds ?? 0) > 0) add(item, 'resume');
  for (const row of continuing) for (const item of row.items) if (item.kind === 'title' && item.title.kind === 'episode') add(item, 'nextEpisode');
  for (const row of rows.filter(r => r.purpose === 'recentlyAdded')) for (const item of row.items) add(item, 'newRelease');
  for (const row of rows.filter(r => r.purpose !== 'continue' && r.purpose !== 'nextUp' && r.purpose !== 'recentlyAdded')) for (const item of row.items) add(item, 'featured');
  const shelves = rows.map(row => ({ ...row, items: [...row.items] }));
  for (const hero of heroes) {
    const row = shelves.find(r => r.items.some(item => item.kind === 'title' && identity(item.title) === identity(hero.title)));
    if (!row) continue;
    const remaining = row.items.filter(item => item.kind !== 'title' || identity(item.title) !== identity(hero.title));
    if (remaining.length) row.items = remaining;
  }
  return { heroes, rows: shelves };
}
