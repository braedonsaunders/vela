import { ContentLoader } from '../common/loading';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { msg, number, plural } from '@vela/core';
import { useVela } from '@vela/core/react';
import { shellHasLibraryTabs } from './navigation';
import { toolbarTabs, tabSearchEnabled } from './toolbar-model';
import type { FacetValue, LibraryFacet } from '../../../../protocol/types';
import { FocusPressable } from '../../focus';
import { InheritedContext, useHost, type WidgetProps } from '../../host';
import { holdBack } from '../../menu-key';
import { useFocusClaim } from '../common/focus-claim';
import { useLook } from '../common/look';
import { Select } from '../common/select';
import { YearInput } from './year-input';
import type { ReactNode, ComponentRef } from 'react';
import { TextField } from '../common/text-field';
import { singleLibraryStrip, tabOverflow } from './toolbar-layout';
import { SheetModal } from '../common/sheet-modal';

// All toolbar surfaces share these rows; skins own their dimensions, shape, font and colours.
const control = { height: '$ui.controlHeight', padding: '0px 12px', 'border-radius': '$ui.radiusControl', 'background-color': '$ui.control', border: '1px solid $ui.glassEdge', 'justify-content': 'center', 'flex-shrink': '0' };
const controlText = { color: '$ui.ink', 'font-size': '$ui.controlFontSize', 'font-weight': '500' };

/** A control label centred on its line: Android otherwise pads the line for accents above it. */
const CENTRED = { textAlign: 'center', includeFontPadding: false, textAlignVertical: 'center' } as const;

function Button({ label, onPress, selected = false, role = 'button', id, quiet = false, preferred = false, onLayout, onFocus }: {
  onLayout?(event: LayoutChangeEvent): void; onFocus?(): void; id?: string; label: string; onPress(): void; selected?: boolean; quiet?: boolean; preferred?: boolean; role?: 'button' | 'tab' | 'checkbox';
}) {
  const look = useLook();
  const [focused, focus] = useState(false);
  const claim = useFocusClaim(preferred);
  const tab = role === 'tab';
  const text = look.text({ ...controlText, color: tab && selected ? '$ui.onAccent' : quiet ? '$ui.inkSecondary' : '$ui.ink', 'font-weight': tab && selected ? '700' : '500' });
  return <FocusPressable onLayout={onLayout} nativeID={id} accessibilityRole={role} accessibilityLabel={label} accessibilityState={{ selected, checked: role === 'checkbox' ? selected : undefined }}
    {...(Platform.OS === 'web' ? { 'aria-selected': tab ? selected : undefined, 'aria-checked': role === 'checkbox' ? selected : undefined } : {})}
    hasTVPreferredFocus={claim} onFocus={event => { focus(true); onFocus?.(); if (Platform.OS === 'web') (event.target as unknown as HTMLElement).scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }} onBlur={() => focus(false)} onPress={onPress}
    style={look.box({ ...control, position: 'relative',
      'background-color': tab && selected ? '$ui.accent' : focused || selected ? '$ui.controlHover' : '$ui.control',
      'border-color': focused && tab && selected ? '$ui.ink' : focused ? '$ui.accent' : '$ui.glassEdge' })}>
    {/* A tab's bold selected label must not resize the strip while its scenes are moving. */}
    {tab && <Text accessible={false} numberOfLines={1} style={[look.text({ ...controlText, 'font-weight': '700' }), CENTRED,
      Platform.OS === 'web' ? { visibility: 'hidden' } as never : { opacity: 0 }]}>{label}</Text>}
    {tab
      // The label lies over the sizing copy, centred in the pill's inner box by layout rather than
      // a line height: a TV draws the control's px larger, and fonts place a line's glyphs differently.
      ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, look.box({ padding: control.padding, 'justify-content': 'center' })]}>
        <Text accessible={false} numberOfLines={1} style={[text, CENTRED]}>{label}</Text>
      </View>
      : <Text accessible={false} numberOfLines={1} style={[text, CENTRED]}>{role === 'checkbox' && selected ? '✓ ' : ''}{label}</Text>}

  </FocusPressable>;
}

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

/** The tab strip is its own scroll owner so large server-declared sets cannot squeeze the page. */
export function LibraryTabs(_props: Partial<WidgetProps> = {}) {
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
  // An opened collection keeps its way back outside the scrolling tabs, where it is always seen.
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: '100%' }}>
    {page?.facetTitle && <Button label={msg('library.backToCollections')} onPress={() => host.dispatch('libraryView', page.tabId ?? 'collections')} />}
    <View style={[{ position: 'relative', minWidth: 0, flexShrink: 1 }, Platform.OS === 'web' && { width: 'max-content', maxWidth: '100%' } as never]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" accessibilityRole="tablist" accessibilityLabel={msg('library.views')}
        {...scrollProps} style={{ minWidth: 0 }} contentContainerStyle={{ flexDirection: 'row', gap: 8, padding: 3 }}>
        {tabs.map(tab => <Button key={tab.id} id={`vela-library-view-${tab.id}`} role="tab" label={tab.label}
          onLayout={event => { positions.current[tab.id] = event.nativeEvent.layout; if (activeId === tab.id) reveal(tab.id, false); }}
          onFocus={() => reveal(tab.id, true)} selected={activeId === tab.id} onPress={() => host.dispatch('libraryView', tab.id)} />)}
      </ScrollView>
      {edges}
    </View>
  </View>;
}

/** Filters and sorting scroll sideways together when they outgrow the width; the edge buttons
 * say there is more. */
function FilterStrip({ children }: { children: ReactNode }) {
  const { scrollProps, edges } = useOverflowStrip({ before: msg('library.previousFilters'), after: msg('library.moreFilters') });
  return <View style={{ position: 'relative', width: '100%', minWidth: 0 }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" {...scrollProps}
      style={{ width: '100%', minWidth: 0 }} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 3 }}>{children}</ScrollView>
    {edges}
  </View>;
}

function ToolbarField({ children, width }: { children: ReactNode; width?: number }) {
  const look = useLook();
  return <InheritedContext.Provider value={{ rows: { color: look.ui.ink, 'font-family': look.ui.font, 'font-size': `${look.ui.controlFontSize}px`, 'font-weight': '500' }, fontSize: look.ui.controlFontSize }}>
    {/* On the web the edge is drawn inside, so the select or field itself fills the whole 44px target. */}
    <View style={[look.box(control), width ? { width } : {}, Platform.OS === 'web' && { borderWidth: 0, boxShadow: `inset 0px 0px 0px 1px ${look.ui.glassEdge}` } as never]}>{children}</View>
  </InheritedContext.Provider>;
}

export function LibraryToolbar(props: WidgetProps) {
  const host = useHost();
  const look = useLook();
  const page = host.env.library;
  const model = page?.model;
  const tabsInShell = host.env.small && shellHasLibraryTabs(host.doc.document.slots?.shell);
  const singleStrip = singleLibraryStrip(host.viewport.width, Platform.isTV);
  const browse = (page?.view ?? 'library') === 'library';
  const select = (params: Record<string, string>, width?: number) => <ToolbarField width={width ?? (Platform.OS === 'web' ? undefined : 180)}><Select ctx={props.ctx} params={params} /></ToolbarField>;
  const filters = <>
    {browse ? <LibraryFacets key={`${model?.id}:${page?.tabId}:${browse}`} /> : <><TabSearch key={`${model?.id}:${page?.tabId}`} />{page?.view === 'live' && <LiveFilters />}</>}
    {browse && model && <>
      {model.kinds.length > 1 && select({ options: 'library.kinds', action: 'libraryFilter', arg: 'kind|{value}', none: 'All kinds', label: 'Kind' })}
      {model.canPlayed && select({ options: 'library.played', choices: '|All;false|Unwatched;true|Watched', action: 'libraryFilter', arg: 'played|{value}', label: 'Watched filter' })}
      {model.canFavorite && <Button label="Favourites" selected={model.favoriteFilter} onPress={() => host.dispatch('libraryFilter', model.favoriteFilter ? 'favorite|' : 'favorite|true')} />}
      {!!model.genres.length && select({ options: 'library.genres', action: 'libraryFilter', arg: 'genre|{value}', none: 'Any genre', label: 'Genre' })}
      {model.canYear && <ToolbarField width={100}><YearInput ctx={props.ctx} params={{ placeholder: 'Year', label: 'Year' }} /></ToolbarField>}
    </>}
  </>;
  const sort = browse && model && <View style={{ flexDirection: 'row', gap: 8, flexShrink: 0, alignItems: 'center' }}>
    {model.sorts.length > 1 && select({ options: 'library.sorts', action: 'librarySort', label: 'Sort by' })}
    {model.sorts.find(sort => sort.id === model.sort)?.directions.length === 2 && <Button label={model.direction === 'asc' ? 'Ascending' : 'Descending'} onPress={() => host.dispatch('librarySortFlip', '')} />}
  </View>;
  const tab = page?.model?.tabs?.find(tab => tab.id === page?.tabId);
  const hasFilters = browse || tabSearchEnabled(tab) || page?.view === 'live';
  const total = browse && !page?.facetTitle && model?.total !== undefined && !page?.loading ? msg(`library.count.${plural(model.total)}`, { count: number(model.total) }) : '';
  if (tabsInShell && !hasFilters) return null;
  // Tabs keep a row of their own: filters arriving later (a genre list) never squeeze them, and
  // the filters and sort share one scrollable row below.
  return <View testID="library-toolbar" accessibilityRole="toolbar" accessibilityLabel={msg('library.toolbar')} style={{ paddingVertical: 8, flexDirection: 'column', alignItems: 'stretch', gap: 6, minWidth: 0 }}>
    {!tabsInShell && <LibraryTabs />}
    {hasFilters && <View style={{ minHeight: look.ui.controlHeight + 6, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <View style={{ flex: 1, minWidth: 0 }}><FilterStrip>{filters}{sort}</FilterStrip></View>
      {!!total && !singleStrip && <Text accessibilityLiveRegion="polite" style={[look.text({ color: '$ui.inkSecondary', 'font-size': '$ui.controlFontSize', 'font-weight': '500' }), { flexShrink: 0 }]}>{total}</Text>}
    </View>}
    {!!total && singleStrip && <Text accessibilityLiveRegion="polite" style={look.text({ color: '$ui.inkSecondary', 'font-size': '13px', 'font-weight': '500' })}>{total}</Text>}
    {page?.extrasFailed && <View style={{ flexDirection: 'row' }}><Button label="Try again" onPress={() => host.dispatch('retry', '')} /></View>}
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

export function LibraryFacets() {
  const host = useHost();
  const store = useVela();
  const model = host.env.library?.model;
  const look = useLook();
  const [search, setSearch] = useState(model?.query ?? '');
  const [open, setOpen] = useState<LibraryFacet>();
  const [labels, setLabels] = useState<Record<string, Record<string, string>>>({});
  const selectedKey = JSON.stringify(model?.facetFilters ?? {});
  useEffect(() => {
    if (!model?.canSearch) return;
    let active = true;
    for (const [field, ids] of Object.entries(model.facetFilters ?? {})) {
      if (ids.every(id => labels[field]?.[id])) continue;
      void store.catalogue.libraryFacets(model.id, field).then(page => {
        if (active) setLabels(previous => ({ ...previous, [field]: { ...previous[field], ...Object.fromEntries(page.items.map(value => [value.id, value.label])) } }));
      }).catch(() => {}); // The picker provides an explicit retry; chips can still clear by ID.
    }
    return () => { active = false; };
  }, [store, model?.id, model?.canSearch, selectedKey]);
  useEffect(() => setSearch(model?.query ?? ''), [model?.query]);
  useEffect(() => {
    const timer = setTimeout(() => { if (search !== (model?.query ?? '')) host.dispatch('libraryFilter', `query|${search}`); }, 350);
    return () => clearTimeout(timer);
  }, [search, model?.query, host.dispatch]);
  if (!model?.canSearch) return null;
  const searchField = <TextField accessibilityLabel="Search this library" placeholder="Search this library" placeholderTextColor={look.ui.inkSecondary} value={search} onChangeText={setSearch}
    style={[look.text(controlText), look.box({ ...control, width: '220px' }), Platform.OS === 'web' && { fontSize: 16 }]} />;
  function choose(facet: LibraryFacet, id: string) {
    const next = { ...model!.facetFilters };
    const selected = next[facet.id] ?? [];
    next[facet.id] = selected.includes(id) ? selected.filter(value => value !== id) : facet.multi ? [...selected, id] : [id];
    if (!next[facet.id].length) delete next[facet.id];
    host.dispatch('libraryFilter', `facets|${JSON.stringify(next)}`);
  }
  const active = model.facets?.flatMap(facet => (model.facetFilters?.[facet.id] ?? []).map(id => ({ facet, id }))) ?? [];
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      {searchField}
      {model.facets?.map(facet => <Button key={facet.id} label={facet.label} selected={open?.id === facet.id} onPress={() => setOpen(facet)} />)}
      {active.map(({ facet, id }) => <Button key={`${facet.id}:${id}`} label={`${labels[facet.id]?.[id] ?? id} ×`} selected onPress={() => choose(facet, id)} />)}
      {!!active.length && <Button label="Clear filters" quiet onPress={() => host.dispatch('libraryFilter', 'facets|{}')} />}
    {open && <FacetPicker key={`${model.id}:${open.id}`} facet={open} selected={model.facetFilters?.[open.id] ?? []} onChoose={id => choose(open, id)} onClose={() => setOpen(undefined)}
      onLabels={values => setLabels(previous => ({ ...previous, [open.id]: { ...previous[open.id], ...values } }))} />}
  </View>;
}

/** A bounded picker leaves the browse toolbar compact and gives native remotes a focus scope. */
function FacetPicker({ facet, selected, onChoose, onClose, onLabels }: {
  facet: LibraryFacet; selected: string[]; onChoose(id: string): void; onClose(): void; onLabels(values: Record<string, string>): void;
}) {
  const host = useHost();
  const store = useVela();
  const look = useLook();
  const libraryId = host.env.library!.model!.id;
  const [query, setQuery] = useState('');
  const [values, setValues] = useState<FacetValue[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useState(0);
  const generation = useRef(0);
  const labels = useRef(onLabels); labels.current = onLabels;
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => holdBack(() => { close.current(); return true; }), []);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close.current(); } };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, []);
  useEffect(() => {
    let active = true;
    generation.current++;
    setLoading(true); setFailed(false);
    const timer = setTimeout(() => {
      void store.catalogue.libraryFacets(libraryId, facet.id, query).then(page => {
        if (!active) return;
        setValues(page.items); setCursor(page.nextCursor);
        labels.current(Object.fromEntries(page.items.map(v => [v.id, v.label])));
      }).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; generation.current++; clearTimeout(timer); };
  }, [store, libraryId, facet.id, query, attempt]);
  return <SheetModal open scrim={look.ui.scrim} still={look.still} onRequestClose={onClose}>
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 20 }]}>
      <FocusPressable style={StyleSheet.absoluteFill} focusable={false} accessibilityLabel={`Close ${facet.label}`} onPress={onClose} />
      <View accessibilityViewIsModal accessibilityRole={Platform.OS === 'web' ? 'dialog' as never : undefined} accessibilityLabel={facet.label}
        style={look.box({ width: '100%', 'max-width': '420px', 'max-height': '80vh', padding: '16px', gap: '12px', 'border-radius': '$ui.radiusPanel', 'background-color': '$ui.popover', border: '1px solid $ui.glassEdgeStrong', 'box-shadow': '0px 24px 80px $ui.shadow' })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={look.text({ 'font-size': '18px', 'font-weight': '650' })}>{facet.label}</Text>
          <Button label="Done" quiet preferred onPress={onClose} />
        </View>
        <TextField accessibilityLabel={`Search ${facet.label}`} placeholder={`Search ${facet.label}`} placeholderTextColor={look.ui.inkSecondary} value={query} onChangeText={setQuery}
          style={[look.text({}), look.box({ height: '40px', padding: '0px 12px', border: '1px solid $ui.glassEdge', 'border-radius': '$ui.radiusControl' })]} />
        {loading ? <ContentLoader inline={values.length > 0} /> : failed ? <Button label="Try again" onPress={() => retry(v => v + 1)} /> : <>
          {!values.length && <Text style={look.text({})}>No values</Text>}
          <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
            {values.map(value => <Button key={value.id} role="checkbox" label={`${value.label} (${value.count})`} selected={selected.includes(value.id)} onPress={() => onChoose(value.id)} />)}
          </ScrollView>
          {cursor && <Button label="More values" onPress={() => {
            const request = generation.current;
            setLoading(true);
            void store.catalogue.libraryFacets(libraryId, facet.id, query, cursor).then(page => {
              if (request !== generation.current) return;
              setValues(previous => [...new Map([...previous, ...page.items].map(value => [value.id, value])).values()]); setCursor(page.nextCursor);
              labels.current(Object.fromEntries(page.items.map(v => [v.id, v.label])));
            }).catch(() => { if (request === generation.current) setFailed(true); }).finally(() => { if (request === generation.current) setLoading(false); });
          }} />}
        </>}
      </View>
    </View>
  </SheetModal>;
}
