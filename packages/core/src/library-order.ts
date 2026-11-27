// The viewer's own order for their libraries in the navigation, and the ones they hid from it,
// remembered per viewer and per server. Libraries the viewer has not placed yet (new ones) follow
// in the server's order; a library the server no longer lists keeps its place, so a server that
// is briefly offline does not lose the viewer's choices. Pure: no store, no storage.

/** One viewer's choices on one server: library ids in their order, and the hidden ones. */
export interface LibraryOrder {
  order: string[];
  hidden: string[];
}

export type LibraryOrderMap = Record<string, LibraryOrder>;

/** A library in the viewer's order, and whether they hid it from the navigation. */
export interface OrderedLibrary<T> {
  library: T;
  hidden: boolean;
}

/** Every library the server lists, in the viewer's order, each with whether it is hidden. */
export function orderLibraries<T extends { id: string }>(libraries: readonly T[], preference: LibraryOrder | undefined): OrderedLibrary<T>[] {
  const place = new Map((preference?.order ?? []).map((id, index) => [id, index]));
  const hidden = new Set(preference?.hidden ?? []);
  const placed = libraries.filter(library => place.has(library.id)).sort((a, b) => place.get(a.id)! - place.get(b.id)!);
  const added = libraries.filter(library => !place.has(library.id));
  return [...placed, ...added].map(library => ({ library, hidden: hidden.has(library.id) }));
}

/** The libraries the navigation lists: in the viewer's order, without the hidden ones. Without
 * a preference this is the server's list itself. */
export function arrangeLibraries<T extends { id: string }>(libraries: T[], preference: LibraryOrder | undefined): T[] {
  if (!preference?.order.length && !preference?.hidden.length) return libraries;
  return orderLibraries(libraries, preference).filter(item => !item.hidden).map(item => item.library);
}

/** Move a library one place up (-1) or down (1) past the next library the server lists now;
 * libraries it no longer lists keep their places. At either end nothing changes. */
export function moveLibrary(libraries: readonly { id: string }[], preference: LibraryOrder | undefined, id: string, step: -1 | 1): LibraryOrder {
  const current = preference ?? { order: [], hidden: [] };
  const listed = new Set(libraries.map(library => library.id));
  if (!listed.has(id)) return current;
  const placed = new Set(current.order);
  const order = [...current.order, ...libraries.map(library => library.id).filter(item => !placed.has(item))];
  const from = order.indexOf(id);
  let to = from + step;
  while (to >= 0 && to < order.length && !listed.has(order[to]!)) to += step;
  if (to < 0 || to >= order.length) return current;
  [order[from], order[to]] = [order[to]!, order[from]!];
  return { order, hidden: current.hidden };
}

/** Hide a library from the navigation, or show it again. Each change places the libraries the
 * server lists now after the viewer's order, as a move does, so a library it lists later goes at
 * the end. */
export function setLibraryHidden(libraries: readonly { id: string }[], preference: LibraryOrder | undefined, id: string, hidden: boolean): LibraryOrder {
  const current = preference ?? { order: [], hidden: [] };
  if (current.hidden.includes(id) === hidden) return current;
  const placed = new Set(current.order);
  const order = [...current.order, ...libraries.map(library => library.id).filter(item => !placed.has(item))];
  return { order, hidden: hidden ? [...current.hidden, id] : current.hidden.filter(item => item !== id) };
}

/** Collision-free key for one `(serverId, viewerId)` pair. */
export function libraryOrderKey(serverId: string, viewerId: string): string {
  return JSON.stringify([serverId, viewerId]);
}

export function parseLibraryOrderKey(key: string): { serverId: string; viewerId: string } | null {
  try {
    const parsed = JSON.parse(key);
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [serverId, viewerId] = parsed;
    if (typeof serverId !== 'string' || typeof viewerId !== 'string' || !serverId || !viewerId) return null;
    return { serverId, viewerId };
  } catch {
    return null;
  }
}

/** Drop every preference belonging to a removed server. */
export function removeServerLibraryOrders(map: LibraryOrderMap, serverId: string): LibraryOrderMap {
  let changed = false;
  const next: LibraryOrderMap = {};
  for (const [key, value] of Object.entries(map)) {
    const parsed = parseLibraryOrderKey(key);
    if (!parsed || parsed.serverId === serverId) {
      changed = true;
      continue;
    }
    next[key] = value;
  }
  return changed ? next : map;
}

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id !== ''))] : [];

/** Read persisted preferences defensively: malformed keys and entries are dropped. */
export function storedLibraryOrders(value: unknown): LibraryOrderMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: LibraryOrderMap = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!parseLibraryOrderKey(key) || !entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const order = ids(raw.order), hidden = ids(raw.hidden);
    if (order.length || hidden.length) result[key] = { order, hidden };
  }
  return result;
}
