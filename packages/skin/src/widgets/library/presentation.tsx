// The library toolbar (widget `libraryToolbar`, placed by every built-in skin through the
// velaLibraryViews template): the library's tabs, or an opened collection's way back and title,
// then on the same row its search, one Filters button (every facet, kind, watched, genre and year
// control in a panel, with a count of those in force), one Sort button, an optional A–Z jump
// button for title-sorted libraries and the count. Filters in force show as removable chips under
// it, only while there are any. A failed view's Try again is the view's own
// (velaLibraryAlternative), never the toolbar's.
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { msg, number, plural } from '@vela/core';
import { useVela } from '@vela/core/react';
import { shellHasLibraryTabs } from './navigation';
import { activeFilters, clearFiltersArg, hasFilterControls, lockedFacet, tabSearchEnabled, toolbarLayout, toolbarTabs } from './toolbar-model';
import { useHost, type WidgetProps } from '../../host';
import { useLook } from '../common/look';
import type { ComponentRef } from 'react';
import { TextField } from '../common/text-field';
import { tabOverflow } from './toolbar-layout';
import { Button, control, controlText } from './toolbar-controls';
import { FiltersPanel, JumpPanel, SortPanel, type Anchor } from './filters';
import { activeJumpBucket, useJumpFocus } from './jump';

/** A horizontal strip that scrolls on its own and shows real buttons at a clipped edge, so
 * hidden tabs or filters are both hinted at and reachable with a pointer. Keyboard and remote
 * focus scroll the strip by themselves, so the edge buttons stay out of the focus order. */
function useOverflowStrip(names: { before: string; after: string }, resized?: () => void) {
  const look = useLook();
  const strip = useRef<ComponentRef<typeof ScrollView>>(null);
  const metrics = useRef({ x: 0, width: 0, content: 0 });
  const [overflow, setOverflow] = useState({ before: false, after: false });
  const update = () => {
    const { x, width, content } = metrics.current;
    setOverflow(value => {
      const next = tabOverflow(x, width, content);
      return value.before === next.before && value.after === next.after ? value : next;
    });
  };
  const scrollTo = (x: number, animated: boolean) => {
    metrics.current.x = Math.max(0, Math.min(Math.max(0, metrics.current.content - metrics.current.width), x));
    strip.current?.scrollTo({ x: metrics.current.x, animated });
    update();
  };
  const page = (direction: -1 | 1) => scrollTo(metrics.current.x + direction * Math.max(80, metrics.current.width * 0.75), true);
  const wheel = Platform.OS === 'web' ? { onWheel: (event: { nativeEvent?: { deltaX?: number; deltaY?: number } }) => {
    const native = event.nativeEvent ?? event as never as { deltaX?: number; deltaY?: number };
    const delta = Math.abs(native.deltaY ?? 0) > Math.abs(native.deltaX ?? 0) ? native.deltaY ?? 0 : native.deltaX ?? 0;
    if (delta && metrics.current.content > metrics.current.width) scrollTo(metrics.current.x + delta, false);
  } } : {};
  const scrollProps = {
    ref: strip,
    onLayout: (event: LayoutChangeEvent) => { metrics.current.width = event.nativeEvent.layout.width; update(); resized?.(); },
    onContentSizeChange: (width: number) => { metrics.current.content = width; update(); resized?.(); },
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => { metrics.current.x = event.nativeEvent.contentOffset.x; update(); },
    scrollEventThrottle: 16,
    ...wheel,
  };
  const edge = (side: 'before' | 'after') => <Pressable key={side} onPress={() => page(side === 'before' ? -1 : 1)} focusable={false}
    accessibilityRole="button" accessibilityLabel={names[side]} {...(Platform.OS === 'web' ? { tabIndex: -1 } as object : {})}
    style={{ position: 'absolute', top: 0, bottom: 0, [side === 'before' ? 'left' : 'right']: 0, width: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: look.ui.page,
      ...(Platform.OS === 'web' ? { boxShadow: `${side === 'before' ? 12 : -12}px 0px 12px ${look.ui.page}`, cursor: 'pointer' } as object : {}) }}>
    <View style={look.box({ width: '30px', height: '30px', 'border-radius': '15px', 'background-color': '$ui.control', border: '1px solid $ui.glassEdge', 'align-items': 'center', 'justify-content': 'center' })}>
      <Text accessible={false} style={[look.text({ color: '$ui.ink', 'font-size': '20px', 'font-weight': '700' }), { lineHeight: 22, marginTop: -2 }]}>{side === 'before' ? '‹' : '›'}</Text>
    </View>
  </Pressable>;
  const edges = <>{overflow.before && edge('before')}{overflow.after && edge('after')}</>;
  return { strip, metrics, scrollProps, edges };
}

/** The tab strip is its own scroll owner so large server-declared sets cannot squeeze the page.
 * Inside an opened collection it gives way to the collection's way back and title. */
export function LibraryTabs(_props: Partial<WidgetProps> = {}) {
  const host = useHost();
  const page = host.env.library;
  if (page?.facetTitle) return <CollectionHeading />;
  return <TabStrip />;
}

function TabStrip() {
  const host = useHost();
  const page = host.env.library;
  const tabs = toolbarTabs(page);
  const activeId = page?.tabId ?? page?.view;
  const positions = useRef<Record<string, { x: number; width: number }>>({});
  const reveal = (id: string, animated: boolean) => {
    const position = positions.current[id];
    if (!position || !metrics.current.width) return;
    const x = Math.max(0, position.x - Math.max(12, (metrics.current.width - position.width) / 2));
    strip.current?.scrollTo({ x, animated });
  };
  const { strip, metrics, scrollProps, edges } = useOverflowStrip({ before: msg('library.previousTabs'), after: msg('library.nextTabs') }, () => { if (activeId) reveal(activeId, false); });
  useEffect(() => { if (activeId) reveal(activeId, false); }, [activeId, tabs.length]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.getElementById(`vela-library-view-${page?.tabId ?? page?.view}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [page?.tabId, page?.view]);
  return <View style={[{ position: 'relative', minWidth: 0, flexShrink: 1 }, Platform.OS === 'web' && { width: 'max-content', maxWidth: '100%' } as never]}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" accessibilityRole="tablist" accessibilityLabel={msg('library.views')}
      {...scrollProps} style={{ minWidth: 0 }} contentContainerStyle={{ flexDirection: 'row', gap: 8, padding: 3 }}>
      {tabs.map(tab => <Button key={tab.id} id={`vela-library-view-${tab.id}`} role="tab" label={tab.label}
        onLayout={event => { positions.current[tab.id] = event.nativeEvent.layout; if (activeId === tab.id) reveal(tab.id, false); }}
        onFocus={() => reveal(tab.id, true)} selected={activeId === tab.id} onPress={() => host.dispatch('libraryView', tab.id)} />)}
    </ScrollView>
    {edges}
  </View>;
}

/** An opened collection: back to the tab it was opened from, and its title, on one row. */
function CollectionHeading() {
  const host = useHost();
  const look = useLook();
  const page = host.env.library;
  const tab = toolbarTabs(page).find(candidate => candidate.id === page?.tabId);
  const back = tab?.label ?? msg('library.view.collections');
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0, flexShrink: 1, padding: 3 }}>
    <Button icon="back" label={back} accessibilityLabel={msg('library.backTo', { tab: back })} onPress={() => host.dispatch('libraryView', page?.tabId ?? 'collections')} />
    <Text accessibilityRole="header" aria-level={2} numberOfLines={1} style={[look.text({ 'font-size': '20px', 'font-weight': '650' }), { flexShrink: 1, minWidth: 0 }]}>{page?.facetTitle}</Text>
  </View>;
}

/** Names for the facet values in force (chips read them), from the server's facet pages. */
function useFacetLabels() {
  const host = useHost();
  const store = useVela();
  const model = host.env.library?.model;
  const [labels, setLabels] = useState<Record<string, Record<string, string>>>({});
  const selectedKey = JSON.stringify(model?.facetFilters ?? {});
  useEffect(() => {
    if (!model?.canSearch) return;
    let active = true;
    for (const [field, ids] of Object.entries(model.facetFilters ?? {})) {
      if (ids.every(id => labels[field]?.[id])) continue;
      void store.catalogue.libraryFacets(model.id, field).then(page => {
        if (active) setLabels(previous => ({ ...previous, [field]: { ...previous[field], ...Object.fromEntries(page.items.map(value => [value.id, value.label])) } }));
      }).catch(() => {}); // The Filters panel offers its own retry; chips still clear by ID.
    }
    return () => { active = false; };
  }, [store, model?.id, model?.canSearch, selectedKey]);
  const add = (field: string, values: Record<string, string>) => setLabels(previous => ({ ...previous, [field]: { ...previous[field], ...values } }));
  return [labels, add] as const;
}

/** The library's own search, sent once typing pauses. */
function LibrarySearch({ grow = false }: { grow?: boolean }) {
  const host = useHost();
  const look = useLook();
  const model = host.env.library?.model;
  const [search, setSearch] = useState(model?.query ?? '');
  useEffect(() => setSearch(model?.query ?? ''), [model?.query]);
  useEffect(() => {
    const timer = setTimeout(() => { if (search !== (model?.query ?? '')) host.dispatch('libraryFilter', `query|${search}`); }, 350);
    return () => clearTimeout(timer);
  }, [search, model?.query, host.dispatch]);
  if (!model?.canSearch) return null;
  return <TextField accessibilityLabel={msg('library.search')} placeholder={msg('library.search')} placeholderTextColor={look.ui.inkSecondary} value={search} onChangeText={setSearch}
    style={[look.text(controlText), look.box({ ...control, width: grow ? 'auto' : host.viewport.width >= 1200 || Platform.isTV ? '220px' : '180px' }), grow ? { flexGrow: 1, flexShrink: 1, minWidth: 0 } : { flexShrink: 1, minWidth: 140 }, Platform.OS === 'web' && { fontSize: 16 }]} />;
}

type Open = { panel: 'filters' | 'sort' | 'jump'; anchor?: Anchor } | undefined;

/** Measures a button in the window, so its panel can open under it. */
function anchorOf(view: { measureInWindow?(callback: (x: number, y: number, width: number, height: number) => void): void } | null, open: (anchor?: Anchor) => void) {
  if (!view?.measureInWindow || Platform.OS !== 'web') return open();
  view.measureInWindow((x, y, width, height) => open({ x, y, width, height }));
}

/** Search, Filters, Sort and optional A–Z Jump for browsing, and the quiet count. */
function BrowseControls({ ctx, compact, grow, labels, onLabels }: {
  ctx: WidgetProps['ctx']; compact: boolean; grow: boolean; labels: Record<string, Record<string, string>>; onLabels(field: string, values: Record<string, string>): void;
}) {
  const host = useHost();
  const look = useLook();
  const page = host.env.library;
  const model = page?.model;
  const [open, setOpen] = useState<Open>();
  const filtersButton = useRef<ComponentRef<typeof Button>>(null);
  const sortButton = useRef<ComponentRef<typeof Button>>(null);
  const jumpButton = useRef<ComponentRef<typeof Button>>(null);
  const jumpFocus = useJumpFocus(page);
  if (!model) return null;
  const locked = lockedFacet(page);
  const active = activeFilters(model, labels, locked).length;
  const sort = model.sorts.find(candidate => candidate.id === model.sort);
  const direction = model.direction === 'asc' ? msg('library.ascending') : msg('library.descending');
  const sortLabel = sort ? `${sort.label} ${sort.directions.length === 2 ? model.direction === 'asc' ? '↑' : '↓' : ''}`.trim() : msg('library.sort');
  const countString = model.media === 'photo'
    ? model.tabs?.some(tab => tab.id === page?.tabId && tab.level === 'album') ? 'media.count.albums' : 'gallery.photoCount'
    : 'library.count';
  const total = !page?.facetTitle && model.total !== undefined && !page?.loading ? msg(`${countString}.${plural(model.total)}`, { count: number(model.total) }) : '';
  const filtersLabel = active ? msg('library.filtersActive', { count: active }) : msg('library.filters');
  const jumpBuckets = page?.jumpBuckets;
  const activeJump = activeJumpBucket(jumpBuckets, page?.jumpStart);
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, flexShrink: grow ? 1 : 0, flexGrow: grow ? 1 : 0 }}>
    <LibrarySearch grow={grow} />
    {hasFilterControls(model, locked) && <Button ref={filtersButton} testID="library-filters" icon="filter" iconOnly={compact} label={msg('library.filters')} accessibilityLabel={filtersLabel}
      badge={active || undefined} selected={active > 0} expanded={open?.panel === 'filters'} onPress={() => anchorOf(filtersButton.current as never, anchor => setOpen({ panel: 'filters', anchor }))} />}
    {model.sorts.length > 1 && <Button ref={sortButton} testID="library-sort" icon="sort" iconOnly={compact} label={sortLabel} accessibilityLabel={msg('library.sortSummary', { sort: sort?.label ?? '', direction })}
      expanded={open?.panel === 'sort'} onPress={() => anchorOf(sortButton.current as never, anchor => setOpen({ panel: 'sort', anchor }))} />}
    {!!jumpBuckets?.length && <Button ref={jumpButton} testID="library-jump" label={activeJump ? activeJump.label : msg('library.jump')}
      accessibilityLabel={activeJump ? msg('library.jumpActive', { letter: activeJump.label }) : msg('library.jumpLabel')}
      selected={!!activeJump} expanded={open?.panel === 'jump'}
      onPress={() => { jumpFocus.cancel(); anchorOf(jumpButton.current as never, anchor => setOpen({ panel: 'jump', anchor })); }} />}
    {!!total && <Text accessibilityLiveRegion="polite" numberOfLines={1} style={[look.text({ color: '$ui.inkSecondary', 'font-size': compact ? '13px' : '$ui.controlFontSize', 'font-weight': '500' }), { flexShrink: 0, marginLeft: 4 }]}>{total}</Text>}
    {open?.panel === 'filters' && <FiltersPanel ctx={ctx} anchor={open.anchor} labels={labels} onLabels={onLabels} onClose={() => setOpen(undefined)} />}
    {open?.panel === 'sort' && <SortPanel anchor={open.anchor} onClose={() => setOpen(undefined)} />}
    {open?.panel === 'jump' && <JumpPanel anchor={open.anchor} onClose={() => setOpen(undefined)} onJump={jumpFocus.focusAfterJump} />}
  </View>;
}

/** The filters in force, each removable, and Clear all; nothing while none are. */
function ActiveChips({ labels }: { labels: Record<string, Record<string, string>> }) {
  const host = useHost();
  const page = host.env.library;
  const active = activeFilters(page?.model, labels, lockedFacet(page));
  if (!active.length) return null;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" accessibilityLabel={msg('library.activeFilters')}
    style={{ minWidth: 0 }} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 3 }}>
    {active.map(filter => <Button key={filter.key} label={filter.label} trailing="close" selected accessibilityLabel={msg('library.removeFilter', { label: filter.label })}
      onPress={() => host.dispatch('libraryFilter', filter.arg)} />)}
    {active.length > 1 && <Button label={msg('library.clearFilters')} quiet onPress={() => host.dispatch('libraryFilter', clearFiltersArg(page?.model, lockedFacet(page)))} />}
  </ScrollView>;
}

export function LibraryToolbar(props: WidgetProps) {
  const host = useHost();
  const page = host.env.library;
  const [labels, addLabels] = useFacetLabels();
  const tabsInShell = host.env.small && shellHasLibraryTabs(host.doc.document.slots?.shell);
  const layout = toolbarLayout(host.viewport.width, Platform.isTV);
  const browse = (page?.view ?? 'library') === 'library';
  const tab = page?.model?.tabs?.find(candidate => candidate.id === page?.tabId);
  const hasFilters = browse || tabSearchEnabled(tab) || page?.view === 'live';
  // The shell already lists the tabs on a phone; an opened collection still needs its way back.
  const lead = tabsInShell && !page?.facetTitle ? null : <LibraryTabs />;
  if (!lead && !hasFilters) return null;
  const frame = { paddingVertical: 8, gap: 6, minWidth: 0 } as const;
  // A collections, people or live tab carries only its search (and live's filters): it shares the
  // tabs' row, the tabs scrolling inside their own strip when space runs short.
  if (!browse) {
    return <View testID="library-toolbar" accessibilityRole="toolbar" accessibilityLabel={msg('library.toolbar')} style={frame}>
      <View style={{ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {lead && <View style={{ flexShrink: 1, minWidth: 0 }}>{lead}</View>}
        {hasFilters && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}><TabSearch key={`${page?.model?.id}:${page?.tabId}`} />{page?.view === 'live' && <LiveFilters />}</View>}
      </View>
    </View>;
  }
  const controls = (grow: boolean) => <BrowseControls key={`${page?.model?.id}:${page?.tabId}`} ctx={props.ctx} compact={layout === 'phone'} grow={grow} labels={labels} onLabels={addLabels} />;
  // Browsing: one row where the width allows, the tabs taking what the controls leave and
  // scrolling inside it; otherwise the tabs over the controls. Chips only while filters are in force.
  return <View testID="library-toolbar" accessibilityRole="toolbar" accessibilityLabel={msg('library.toolbar')} style={frame}>
    {layout === 'row' || !lead
      ? <View style={{ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {lead && <View style={{ flexShrink: 1, flexGrow: 1, minWidth: 0, flexDirection: 'row' }}>{lead}</View>}
        {controls(!lead)}
      </View>
      : <>
        <View style={{ flexDirection: 'row', minWidth: 0 }}>{lead}</View>
        <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>{controls(true)}</View>
      </>}
    <ActiveChips labels={labels} />
  </View>;
}

function LiveFilters() {
  const host = useHost();
  const page = host.env.library;
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
    {page?.liveFilters?.map(filter => <Button key={filter.key} label={filter.label} role="checkbox" selected={page.liveFilter === filter.key}
      onPress={() => host.dispatch('libraryFilter', `liveFilter|${page.liveFilter === filter.key ? '' : filter.key}`)} />)}
  </View>;
}

function TabSearch() {
  const host = useHost();
  const look = useLook();
  const page = host.env.library;
  const tab = page?.model?.tabs?.find(tab => tab.id === page.tabId);
  const allowed = tabSearchEnabled(tab);
  const [text, setText] = useState(page?.tabQuery ?? '');
  useEffect(() => setText(page?.tabQuery ?? ''), [page?.tabQuery]);
  useEffect(() => {
    const timer = setTimeout(() => { if (allowed && text.trim() !== (page?.tabQuery ?? '')) host.dispatch('libraryFilter', `tabQuery|${text}`); }, 350);
    return () => clearTimeout(timer);
  }, [text, page?.tabQuery, allowed, host.dispatch]);
  if (!allowed) return null;
  const placeholder = tab?.searchPlaceholder || `Search ${tab?.label}`;
  return <TextField accessibilityLabel={placeholder} placeholder={placeholder} value={text} maxLength={100} onChangeText={setText} placeholderTextColor={look.ui.inkSecondary}
    style={[look.text(controlText), look.box({ ...control, width: '220px' }), Platform.OS === 'web' && { fontSize: 16 }]} />;
}

/** Widget `libraryFacets`, for documents placing browse controls themselves: search, Filters
 * and Sort, and the filters in force. */
export function LibraryFacets(props: Partial<WidgetProps> = {}) {
  const host = useHost();
  const [labels, addLabels] = useFacetLabels();
  if (!host.env.library?.model?.canSearch) return null;
  return <View style={{ gap: 6, minWidth: 0 }}>
    <BrowseControls ctx={props.ctx ?? ({} as WidgetProps['ctx'])} compact={toolbarLayout(host.viewport.width, Platform.isTV) === 'phone'} grow={false} labels={labels} onLabels={addLabels} />
    <ActiveChips labels={labels} />
  </View>;
}
