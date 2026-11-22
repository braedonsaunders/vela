// Plugin branching levels (features.pluginLevels): a recommended tab's own shelves, and a
// container's children read one child level at a time (an artist's albums apart from its
// concerts). Every rule here is pure; a server without the feature keeps today's reads.
import type * as V from './wire';
import { msg, number, plural } from './i18n';

export interface PluginLevels {
  /** A tab's `card` shapes its own rows and items (a recommended tab's too), over the library's. */
  tabCards: boolean;
  /** GET /libraries/:id/rows?tab= answers any recommended tab. */
  tabRows: boolean;
  /** GET /titles/:id/children?role= reads one child level; containers carry media.childCounts. */
  childRoles: boolean;
}

export function pluginLevelsOf(features: Partial<V.ServerCapabilities['features']> | undefined): PluginLevels {
  const levels = features?.pluginLevels;
  const available = levels?.available === true;
  return { tabCards: available, tabRows: available && levels?.tabRows === true, childRoles: available && levels?.childRoles === true };
}

/**
 * The tab a library's recommendation rows are read for, or undefined for the library's own rows:
 * no tab, a tab that is not a recommended one, the first recommended tab (which answers exactly
 * the library's rows), or a server without tab rows. So the first tab shares its read and cache
 * with a prefetch and with servers that predate the feature.
 */
export function recommendationTab(tabs: readonly V.LibraryTab[] | undefined, tabId: string | undefined, tabRows: boolean): string | undefined {
  if (!tabRows || !tabId || !tabs) return undefined;
  const recommended = tabs.filter(tab => tab.kind === 'recommended');
  const index = recommended.findIndex(tab => tab.id === tabId);
  return index > 0 ? tabId : undefined;
}

/** The card shape a library view draws: the selected tab's own (a server with tab cards), else the library's. */
export function tabCard(tab: Pick<V.LibraryTab, 'card'> | undefined, library: V.LibraryCard | undefined, tabCards: boolean): V.LibraryCard | undefined {
  const own = tabCards ? tab?.card : undefined;
  return own === 'poster' || own === 'landscape' || own === 'square' ? own : library;
}

/** The store key of a title's children: the whole list, or one child level's. */
export function childrenKey(id: string, role?: string): string {
  return role ? `${id}\u0000role:${role}` : id;
}

/** Valid per-level counts, zero and malformed entries dropped. */
export function childCountsOf(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (key && typeof count === 'number' && Number.isFinite(count) && count >= 1) counts[key] = Math.floor(count);
  }
  return counts;
}

/**
 * An artist's sections, as the keys of its child levels to read one by one: albums first, then
 * the rest (concerts) in the server's order. Empty means the page reads its children whole, as
 * today: a server without child roles, a title without counts, or one with albums alone.
 */
export function childSections(counts: Record<string, number>, childRoles: boolean, primary = 'album'): string[] {
  if (!childRoles) return [];
  const keys = Object.keys(counts).filter(key => counts[key]! > 0);
  if (!keys.length || (keys.length === 1 && keys[0] === primary)) return [];
  return [...keys.filter(key => key === primary), ...keys.filter(key => key !== primary)];
}

/** Plural catalogue names for the child levels Vela knows; any other key is shown as the server wrote it. */
const SECTION_NAMES: Record<string, string> = { album: 'albums', concert: 'concerts', video: 'videos', track: 'tracks', book: 'books', audiobook: 'audiobooks', part: 'parts' };
const SECTION_LABELS: Record<string, string> = { ...SECTION_NAMES, track: 'songs' };

/** A section's switch label: "Albums", "Concerts"; an unknown key capitalised. */
export function childSectionLabel(key: string): string {
  const name = SECTION_LABELS[key];
  return name ? msg(`media.ui.${name}`) : key.charAt(0).toUpperCase() + key.slice(1);
}

/** "4 albums · 2 concerts": a container's children by level, in childSections() order. */
export function childCountsLine(counts: Record<string, number>, primary = 'album'): string {
  const keys = Object.keys(counts);
  return [...keys.filter(key => key === primary), ...keys.filter(key => key !== primary)].map(key => {
    const count = counts[key]!;
    const name = SECTION_NAMES[key] ?? 'titles';
    return msg(`media.count.${name}.${plural(count)}`, { count: number(count) });
  }).join(' · ');
}
