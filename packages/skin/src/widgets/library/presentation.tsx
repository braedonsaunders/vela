import { ContentLoader } from '../common/loading';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
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

// All toolbar surfaces share these rows; skins own their dimensions, shape, font and colours.
const control = { height: '$ui.controlHeight', padding: '0px 12px', 'border-radius': '$ui.radiusControl', 'background-color': '$ui.control', border: '1px solid $ui.glassEdge', 'justify-content': 'center', 'flex-shrink': '0' };
const controlText = { color: '$ui.ink', 'font-size': '$ui.controlFontSize', 'font-weight': '500' };

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
    {tab && <Text accessible={false} numberOfLines={1} style={[look.text({ ...controlText, 'font-weight': '700' }),
      Platform.OS === 'web' ? { visibility: 'hidden' } as never : { opacity: 0 }]}>{label}</Text>}
    <Text accessible={false} numberOfLines={1} style={[text, tab && { position: 'absolute', left: 12, right: 12, top: 0, height: look.ui.controlHeight, lineHeight: look.ui.controlHeight }]}>
      {role === 'checkbox' && selected ? '✓ ' : ''}{label}
    </Text>

  </FocusPressable>;
}

/** The tab strip is its own scroll owner so large server-declared sets cannot squeeze the page. */
export function LibraryTabs(_props: Partial<WidgetProps> = {}) {
  const host = useHost();
  const look = useLook();
  const page = host.env.library;
  const tabs = toolbarTabs(page);
  const activeId = page?.tabId ?? page?.view;
  const strip = useRef<ComponentRef<typeof ScrollView>>(null);
  const positions = useRef<Record<string, { x: number; width: number }>>({});
  const metrics = useRef({ x: 0, width: 0, content: 0 });
  const [overflow, setOverflow] = useState({ before: false, after: false });
  const updateOverflow = () => {
    const { x, width, content } = metrics.current;
    setOverflow(value => {
      const next = { before: x > 2, after: x + width < content - 2 };
      return value.before === next.before && value.after === next.after ? value : next;
    });
  };
  const reveal = (id: string, animated: boolean) => {
    const position = positions.current[id];
    if (!position || !metrics.current.width) return;
    const x = Math.max(0, position.x - Math.max(12, (metrics.current.width - position.width) / 2));
    strip.current?.scrollTo({ x, animated });
  };
  useEffect(() => { if (activeId) reveal(activeId, false); }, [activeId, tabs.length]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.getElementById(`vela-library-view-${page?.tabId ?? page?.view}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [page?.tabId, page?.view]);
  const scrolled = (event: NativeSyntheticEvent<NativeScrollEvent>) => { metrics.current.x = event.nativeEvent.contentOffset.x; updateOverflow(); };
  const wheel = Platform.OS === 'web' ? { onWheel: (event: { nativeEvent?: { deltaX?: number; deltaY?: number } }) => {
    const native = event.nativeEvent ?? event as never as { deltaX?: number; deltaY?: number };
    const delta = Math.abs(native.deltaY ?? 0) > Math.abs(native.deltaX ?? 0) ? native.deltaY ?? 0 : native.deltaX ?? 0;
    if (!delta) return;
    metrics.current.x = Math.max(0, Math.min(metrics.current.content - metrics.current.width, metrics.current.x + delta));
    strip.current?.scrollTo({ x: metrics.current.x, animated: false });
    updateOverflow();
  } } : {};
  return <View style={{ position: 'relative', flex: 1, minWidth: 0 }}>
    <ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" accessibilityRole="tablist" accessibilityLabel="Library views"
      onLayout={event => { metrics.current.width = event.nativeEvent.layout.width; updateOverflow(); if (activeId) reveal(activeId, false); }}
      onContentSizeChange={width => { metrics.current.content = width; updateOverflow(); if (activeId) reveal(activeId, false); }}
      onScroll={scrolled} scrollEventThrottle={16} {...wheel}
      style={{ minWidth: 0 }} contentContainerStyle={{ flexDirection: 'row', gap: 8, padding: 3, paddingRight: 24 }}>
      {page?.facetTitle && <Button label="Back to collections" onPress={() => host.dispatch('libraryView', page.tabId ?? 'collections')} />}
      {tabs.map(tab => <Button key={tab.id} id={`vela-library-view-${tab.id}`} role="tab" label={tab.label}
        onLayout={event => { positions.current[tab.id] = event.nativeEvent.layout; if (activeId === tab.id) reveal(tab.id, false); }}
        onFocus={() => reveal(tab.id, true)} selected={activeId === tab.id} onPress={() => host.dispatch('libraryView', tab.id)} />)}
    </ScrollView>
    {overflow.before && <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, alignItems: 'flex-start', justifyContent: 'center', backgroundColor: look.ui.page }}><Text style={look.text({ color: '$ui.inkSecondary', 'font-size': '22px', 'font-weight': '800' })}>‹</Text></View>}
    {overflow.after && <View pointerEvents="none" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 30, alignItems: 'flex-end', justifyContent: 'center', backgroundColor: look.ui.page }}><Text style={look.text({ color: '$ui.inkSecondary', 'font-size': '22px', 'font-weight': '800' })}>›</Text></View>}
  </View>;
}

function ToolbarField({ children, width }: { children: ReactNode; width?: number }) {
  const look = useLook();
  return <InheritedContext.Provider value={{ rows: { color: look.ui.ink, 'font-family': look.ui.font, 'font-size': `${look.ui.controlFontSize}px`, 'font-weight': '500' }, fontSize: look.ui.controlFontSize }}>
    <View style={[look.box(control), width ? { width } : {}]}>{children}</View>
  </InheritedContext.Provider>;
}

export function LibraryToolbar(props: WidgetProps) {
  const host = useHost();
  const look = useLook();
  const page = host.env.library;
  const model = page?.model;
  const tabsInShell = host.env.small && shellHasLibraryTabs(host.doc.document.slots?.shell);
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
  const strip = (children: ReactNode, flex = true) => <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
    style={{ flex: flex ? 1 : undefined, minWidth: 0 }} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 3 }}>{children}</ScrollView>;
  if (tabsInShell && !browse && !tabSearchEnabled(page?.model?.tabs?.find(tab => tab.id === page.tabId))) return null;
  return <View testID="library-toolbar" accessibilityRole="toolbar" accessibilityLabel="Library toolbar" style={{ minHeight: look.ui.controlHeight + 22, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
    {!tabsInShell && <LibraryTabs />}{strip(filters)}{sort}
    {page?.extrasFailed && <Button label="Try again" onPress={() => host.dispatch('retry', '')} />}
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
    style={[look.text(controlText), look.box({ ...control, width: '220px' })]} />;
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
    style={[look.text(controlText), look.box({ ...control, width: '220px' })]} />;
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
  return <Modal transparent visible animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 20 }]}>
      <FocusPressable style={[StyleSheet.absoluteFill, { backgroundColor: look.ui.scrim }]} focusable={false} accessibilityLabel={`Close ${facet.label}`} onPress={onClose} />
      <View accessibilityViewIsModal accessibilityRole="dialog" accessibilityLabel={facet.label}
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
  </Modal>;
}
