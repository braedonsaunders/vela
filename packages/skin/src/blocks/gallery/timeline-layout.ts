export interface DatedPhoto { id: string; airDate: string }

export type TimelineRow<T> =
  | { kind: 'month' | 'day'; key: string; date: string }
  | { kind: 'photos'; key: string; photos: T[] };

function dateKey(value: string): string {
  const day = /^\d{4}-\d\d-\d\d(?=$|T)/.exec(value)?.[0];
  if (!day) return '';
  const parsed = new Date(day);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : '';
}

/** Group by calendar dates, without converting a photo to the viewer's time zone. */
export function timelineRows<T extends DatedPhoto>(photos: readonly T[], columns: number): TimelineRow<T>[] {
  const months = new Map<string, Map<string, T[]>>();
  const dated = photos.map(photo => ({ photo, date: dateKey(photo.airDate) }));
  dated.sort((a, b) => b.date.localeCompare(a.date));
  for (const { photo, date } of dated) {
    const month = date.slice(0, 7);
    const days = months.get(month) ?? new Map<string, T[]>();
    if (!months.has(month)) months.set(month, days);
    const items = days.get(date) ?? [];
    if (!days.has(date)) days.set(date, items);
    items.push(photo);
  }
  const rows: TimelineRow<T>[] = [];
  const addPhotos = (items: T[]) => {
    for (let at = 0; at < items.length; at += columns) {
      rows.push({ kind: 'photos', key: items[at]!.id, photos: items.slice(at, at + columns) });
    }
  };
  for (const [month, days] of months) {
    rows.push({ kind: 'month', key: `month:${month}`, date: month });
    const items = [...days.values()].flat();
    if (!month || days.size < 2 || items.length < Math.max(12, columns * 2)) {
      addPhotos(items);
      continue;
    }
    for (const [day, taken] of days) {
      rows.push({ kind: 'day', key: `day:${day}`, date: day });
      addPhotos(taken);
    }
  }
  return rows;
}
