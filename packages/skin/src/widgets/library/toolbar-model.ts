import type { LibraryPage } from './model';
import { libraryTabs, msg, type LibraryModel } from '@vela/core';

/** An explicit server list, including an empty list, always wins over legacy views. */
export function toolbarTabs(page: LibraryPage | undefined) {
  return libraryTabs(page?.model?.tabs)?.filter(tab => tab.kind !== 'live' || page?.liveAvailable) ?? [
    ...(page?.canRecommend ? [{ id: 'recommended', label: 'Recommended' }] : []),
    { id: 'library', label: 'Library' },
    ...(page?.extras?.collectionsAvailable ? [{ id: 'collections', label: 'Collections' }] : []),
    ...(page?.extras?.genres.length ? [{ id: 'genres', label: 'Genres' }] : []),
  ];
}

export function tabSearchEnabled(tab: { kind: string; search?: boolean } | undefined) {
  return !!tab && (tab.search ?? (tab.kind === 'collections' || tab.kind === 'people' || tab.kind === 'live'));
}

/** The facet an opened facet collection (an author, a studio) is: it names the page, so it is
 * neither a removable filter nor counted among the viewer's own. */
export function lockedFacet(page: LibraryPage | undefined): string | undefined {
  if (!page?.facetTitle) return undefined;
  const tab = page.model?.tabs?.find(candidate => candidate.id === page.tabId);
  return tab?.kind === 'collections' ? tab.facet : undefined;
}

/** One filter in force, as a removable chip: what it reads and the `libraryFilter` arg removing it. */
export interface ActiveFilter { key: string; label: string; arg: string }

/** The filters in force beyond search and sort, in the order the Filters panel lists them.
 * `labels` names facet values by ID (read from the server's facet pages); an unnamed one shows its ID. */
export function activeFilters(model: LibraryModel | undefined, labels: Record<string, Record<string, string>> = {}, locked?: string): ActiveFilter[] {
  if (!model) return [];
  const out: ActiveFilter[] = [];
  const facets = model.facetFilters ?? {};
  for (const facet of model.facets ?? []) {
    if (facet.id === locked) continue;
    for (const id of facets[facet.id] ?? []) {
      const next = { ...facets, [facet.id]: (facets[facet.id] ?? []).filter(value => value !== id) };
      if (!next[facet.id]!.length) delete next[facet.id];
      out.push({ key: `facet:${facet.id}:${id}`, label: labels[facet.id]?.[id] ?? id, arg: `facets|${JSON.stringify(next)}` });
    }
  }
  if (model.kindFilter) out.push({ key: 'kind', label: model.kinds.find(kind => kind.id === model.kindFilter)?.label ?? model.kindFilter, arg: 'kind|' });
  if (model.playedFilter === 'true' || model.playedFilter === 'false') {
    out.push({ key: 'played', label: msg(model.playedFilter === 'true' ? 'library.filter.watched' : 'library.filter.unwatched'), arg: 'played|' });
  }
  if (model.favoriteFilter) out.push({ key: 'favorite', label: msg('library.filter.favorites'), arg: 'favorite|' });
  if (model.genreFilter) out.push({ key: 'genre', label: model.genres.find(genre => genre.id === model.genreFilter)?.label ?? model.genreFilter, arg: 'genre|' });
  if (model.yearFilter > 0) out.push({ key: 'year', label: String(model.yearFilter), arg: 'year|' });
  return out;
}

/** The `libraryFilter` arg clearing every filter at once, keeping only the locked facet. */
export function clearFiltersArg(model: LibraryModel | undefined, locked?: string): string {
  const kept = locked && model?.facetFilters?.[locked] ? { [locked]: model.facetFilters[locked] } : {};
  return `clear|${JSON.stringify(kept)}`;
}

/** Whether the Filters panel has anything to offer this library. */
export function hasFilterControls(model: LibraryModel | undefined, locked?: string): boolean {
  if (!model) return false;
  return (model.canSearch === true && !!model.facets?.some(facet => facet.id !== locked))
    || model.kinds.length > 1 || model.canPlayed || model.canFavorite || model.genres.length > 0 || model.canYear;
}

/**
 * How the browse toolbar lays out at a width: `row` puts the tabs (or an opened collection's
 * title), search, Filters, Sort and the count on one row; `stacked` gives the tabs a row over
 * the controls; `phone` also draws Filters and Sort as icons so the count still fits beside them.
 * A TV always has the room for one row.
 */
export type ToolbarLayout = 'row' | 'stacked' | 'phone';
export function toolbarLayout(width: number, tv: boolean): ToolbarLayout {
  if (tv || width >= 900) return 'row';
  return width >= 600 ? 'stacked' : 'phone';
}
