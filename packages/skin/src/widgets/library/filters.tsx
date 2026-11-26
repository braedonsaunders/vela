// The browse toolbar's Filters, Sort and Jump panels. One compact button opens each: a popover under it
// on a desktop web page, a sheet from the bottom of a phone, a centred panel on TV (a modal focus
// scope the D-pad walks from its first control). Every facet, kind, watched, favourite, genre
// and year control lives in Filters; a facet's values open in the same panel, with a way back.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { msg, number, type LibraryJumpBucket } from '@vela/core';
import { useVela } from '@vela/core/react';
import type { FacetValue, LibraryFacet } from '../../../../protocol/types';
import { FocusPressable } from '../../focus';
import { useHost, type WidgetProps } from '../../host';
import { holdBack } from '../../menu-key';
import { Glyph } from '../common/controls';
import { useFocusClaim } from '../common/focus-claim';
import { ContentLoader } from '../common/loading';
import { useLook } from '../common/look';
import { SheetModal } from '../common/sheet-modal';
import { TextField } from '../common/text-field';
import { activeJumpBucket } from './jump';
import { Button, CENTRED, ToolbarField } from './toolbar-controls';
import { activeFilters, clearFiltersArg, lockedFacet } from './toolbar-model';
import { YearInput } from './year-input';

/** Where a panel's button sits in the window, so a popover opens under it. */
export interface Anchor { x: number; y: number; width: number; height: number }

type Placement = 'popover' | 'sheet' | 'centre';
/** Back requests closer together than this are one press. */
const SAME_PRESS_MS = 400;
/** tvOS dismisses a modal on Menu itself (react-native-tvos RCTModalHostViewComponentView). */
const NATIVE_MENU_DISMISS = Platform.OS === 'ios' && Platform.isTV;

function usePlacement(anchor: Anchor | undefined): Placement {
  const host = useHost();
  if (Platform.isTV) return 'centre';
  if (host.viewport.width < 600) return 'sheet';
  return anchor && Platform.OS === 'web' ? 'popover' : 'centre';
}

/** A panel over the page. A press outside closes it; Escape and Back take `onBack` (a facet's
 * values back to the Filters list), which is closing at the top level. On tvOS a modal dismisses
 * itself on Menu before telling onRequestClose (react-native-tvos), so there Menu closes the
 * panel from anywhere and the state follows; its on-screen back arrow still steps back. */
function Panel({ label, anchor, onClose, onBack = onClose, children, width = 380 }: { label: string; anchor?: Anchor; onClose(): void; onBack?(): void; children: ReactNode; width?: number }) {
  const host = useHost();
  const look = useLook();
  const placement = usePlacement(anchor);
  // One press can reach several of these (the modal's onRequestClose and Back on tvOS, the
  // keydown and React Native Web's Escape on the web): it steps back once.
  const back = useRef(onBack); back.current = onBack;
  const close = useRef(onClose); close.current = onClose;
  const pressed = useRef(0);
  const goBack = useRef(() => {
    const now = Date.now();
    if (now - pressed.current < SAME_PRESS_MS) return;
    pressed.current = now;
    back.current();
  }).current;
  useEffect(() => holdBack(() => { goBack(); return true; }), []);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); goBack(); } };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, []);
  const { width: vw, height: vh } = host.viewport;
  const panelWidth = Math.min(width, vw - 32);
  const frame = placement === 'popover' && anchor
    ? { position: 'absolute' as const, top: anchor.y + anchor.height + 8, left: Math.max(16, Math.min(anchor.x + anchor.width - panelWidth, vw - panelWidth - 16)), width: panelWidth, maxHeight: Math.max(240, vh - anchor.y - anchor.height - 24) }
    : placement === 'sheet'
      ? { position: 'absolute' as const, left: 0, right: 0, bottom: 0, maxHeight: vh * 0.82 }
      : { width: Platform.isTV ? Math.min(560, vw - 64) : panelWidth, maxHeight: vh * 0.8 };
  const surface = look.box({ padding: '16px', gap: '14px', 'background-color': '$ui.popover', border: '1px solid $ui.glassEdgeStrong', 'box-shadow': '0px 24px 80px $ui.shadow',
    'border-radius': '$ui.radiusPanel' });
  return <SheetModal open scrim={placement === 'popover' ? 'rgba(0, 0, 0, 0.16)' : look.ui.scrim} still={look.still} onRequestClose={NATIVE_MENU_DISMISS ? () => close.current() : goBack}>
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, placement === 'centre' ? { alignItems: 'center', justifyContent: 'center', padding: 20 } : null]}>
      <FocusPressable style={StyleSheet.absoluteFill} focusable={false} accessibilityLabel={msg('ui.close')} onPress={onClose} {...(Platform.OS === 'web' ? { tabIndex: -1 } as object : {})} />
      <View accessibilityViewIsModal accessibilityRole={Platform.OS === 'web' ? 'dialog' as never : undefined} accessibilityLabel={label}
        style={[surface, frame, Platform.OS === 'web' ? { backdropFilter: 'blur(28px) saturate(1.4)', WebkitBackdropFilter: 'blur(28px) saturate(1.4)' } as never : null, placement === 'sheet' ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 16 + host.viewport.insets.bottom } : null]}>
        {children}
      </View>
    </View>
  </SheetModal>;
}

function PanelHeader({ title, onDone, back }: { title: string; onDone(): void; back?: { label: string; onPress(): void } }) {
  const look = useLook();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
    {back && <Button icon="back" iconOnly label={back.label} onPress={back.onPress} />}
    <Text accessibilityRole="header" numberOfLines={1} style={[look.text({ 'font-size': '18px', 'font-weight': '650' }), { flex: 1 }]}>{title}</Text>
    <Button label={msg('library.done')} quiet onPress={onDone} />
  </View>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const look = useLook();
  return <View accessibilityRole={Platform.OS === 'web' ? 'group' as never : undefined} accessibilityLabel={title} style={{ gap: 8 }}>
    <Text style={look.text({ color: '$ui.inkSecondary', 'font-size': '13px', 'font-weight': '600' })}>{title}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
  </View>;
}

/** Every filter a library offers, with a Clear all while any is in force. */
export function FiltersPanel({ anchor, labels, onLabels, onClose, ctx }: {
  anchor?: Anchor; labels: Record<string, Record<string, string>>; onLabels(field: string, values: Record<string, string>): void; onClose(): void; ctx: WidgetProps['ctx'];
}) {
  const host = useHost();
  const look = useLook();
  const page = host.env.library;
  const model = page?.model;
  const locked = lockedFacet(page);
  const [facet, setFacet] = useState<LibraryFacet>();
  if (!model) return null;
  const filter = (arg: string) => host.dispatch('libraryFilter', arg);
  const active = activeFilters(model, labels, locked);
  const facets = model.canSearch ? (model.facets ?? []).filter(candidate => candidate.id !== locked) : [];
  if (facet) {
    return <Panel label={facet.label} anchor={anchor} onClose={onClose} onBack={() => setFacet(undefined)}>
      <FacetValues facet={facet} selected={model.facetFilters?.[facet.id] ?? []} onBack={() => setFacet(undefined)} onClose={onClose}
        onLabels={values => onLabels(facet.id, values)} />
    </Panel>;
  }
  return <Panel label={msg('library.filters')} anchor={anchor} onClose={onClose}>
    <PanelHeader title={msg('library.filters')} onDone={onClose} />
    <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 18, paddingVertical: 2 }}>
      {!!facets.length && <View style={{ gap: 8 }}>{facets.map(candidate => {
        const chosen = model.facetFilters?.[candidate.id] ?? [];
        const summary = chosen.length === 1 ? labels[candidate.id]?.[chosen[0]!] ?? msg('library.facetSelected', { count: 1 }) : chosen.length ? msg('library.facetSelected', { count: chosen.length }) : msg('library.facetAny');
        return <FacetRow key={candidate.id} label={candidate.label} summary={summary} chosen={chosen.length > 0} onPress={() => setFacet(candidate)} />;
      })}</View>}
      {model.kinds.length > 1 && <Section title={msg('library.kind')}>
        <Button role="radio" label={msg('library.allKinds')} selected={!model.kindFilter} onPress={() => filter('kind|')} />
        {model.kinds.map(kind => <Button key={kind.id} role="radio" label={kind.label} selected={model.kindFilter === kind.id} onPress={() => filter(`kind|${kind.id}`)} />)}
      </Section>}
      {(model.canPlayed || model.canFavorite) && <Section title={msg('library.watched')}>
        {model.canPlayed && <>
          <Button role="radio" label={msg('library.filter.all')} selected={!model.playedFilter} onPress={() => filter('played|')} />
          <Button role="radio" label={msg('library.filter.unwatched')} selected={model.playedFilter === 'false'} onPress={() => filter('played|false')} />
          <Button role="radio" label={msg('library.filter.watched')} selected={model.playedFilter === 'true'} onPress={() => filter('played|true')} />
        </>}
        {model.canFavorite && <Button role="checkbox" label={msg('library.filter.favorites')} selected={model.favoriteFilter} onPress={() => filter(model.favoriteFilter ? 'favorite|' : 'favorite|true')} />}
      </Section>}
      {!!model.genres.length && <Section title={msg('library.genre')}>
        <Button role="radio" label={msg('library.anyGenre')} selected={!model.genreFilter} onPress={() => filter('genre|')} />
        {model.genres.map(genre => <Button key={genre.id} role="radio" label={genre.label} selected={model.genreFilter === genre.id} onPress={() => filter(`genre|${genre.id}`)} />)}
      </Section>}
      {model.canYear && <Section title={msg('library.year')}>
        <ToolbarField width={120}><YearInput ctx={ctx} params={{ placeholder: 'YYYY', label: msg('library.year'), placeholderColor: look.ui.inkSecondary }} /></ToolbarField>
      </Section>}
    </ScrollView>
    {!!active.length && <View style={{ flexDirection: 'row', justifyContent: 'flex-start' }}>
      <Button label={msg('library.clearFilters')} quiet onPress={() => filter(clearFiltersArg(model, locked))} />
    </View>}
  </Panel>;
}

/** A facet in the Filters panel: its name, what is chosen, and the way into its values. */
function FacetRow({ label, summary, chosen, onPress }: { label: string; summary: string; chosen: boolean; onPress(): void }) {
  const look = useLook();
  const [focused, focus] = useState(false);
  return <FocusPressable accessibilityRole="button" accessibilityLabel={`${label}: ${summary}`} onPress={onPress} onFocus={() => focus(true)} onBlur={() => focus(false)}
    style={look.box({ display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '12px', height: '$ui.controlHeight', padding: '0px 12px',
      'border-radius': '$ui.radiusControl', 'background-color': focused ? '$ui.controlHover' : '$ui.control', border: `1px solid ${focused ? '$ui.accent' : '$ui.glassEdge'}` })}>
    <Text accessible={false} numberOfLines={1} style={[look.text({ 'font-size': '$ui.controlFontSize', 'font-weight': '600' }), { flexShrink: 0 }]}>{label}</Text>
    <Text accessible={false} numberOfLines={1} style={[look.text({ color: chosen ? '$ui.ink' : '$ui.inkSecondary', 'font-size': '$ui.controlFontSize' }), { flex: 1, textAlign: 'right' }]}>{summary}</Text>
    <Text accessible={false} style={look.text({ color: '$ui.inkSecondary', 'font-size': '18px' })}>›</Text>
  </FocusPressable>;
}

/** One facet value: its name, how many titles have it, and a check while chosen. */
function ValueRow({ label, count, selected, multi, onPress }: { label: string; count: number; selected: boolean; multi: boolean; onPress(): void }) {
  const look = useLook();
  const [focused, focus] = useState(false);
  const ink = selected ? look.ui.ink : look.ui.inkSecondary;
  return <FocusPressable accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityLabel={`${label}, ${number(count)}`} accessibilityState={{ checked: selected }}
    {...(Platform.OS === 'web' ? { 'aria-checked': selected } : {})} onPress={onPress} onFocus={() => focus(true)} onBlur={() => focus(false)}
    style={look.box({ display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '10px', 'min-height': '40px', padding: '0px 12px', 'flex-shrink': '0',
      'border-radius': '$ui.radiusControl', 'background-color': focused ? '$ui.controlHover' : selected ? '$ui.control' : 'transparent', border: `1px solid ${focused ? '$ui.accent' : 'transparent'}` })}>
    <View style={{ width: 18, alignItems: 'center' }}>{selected && <Glyph symbol="checkmark" size={16} color={look.ui.accent} />}</View>
    <Text accessible={false} numberOfLines={1} style={[look.text({ 'font-size': '$ui.controlFontSize', 'font-weight': selected ? '650' : '500' }), { flex: 1 }]}>{label}</Text>
    <Text accessible={false} style={[look.text({ 'font-size': '13px', 'font-weight': '500' }), { color: ink }]}>{number(count)}</Text>
  </FocusPressable>;
}

/** A facet's values, searchable and paged; a choice applies at once. */
function FacetValues({ facet, selected, onBack, onClose, onLabels }: {
  facet: LibraryFacet; selected: string[]; onBack(): void; onClose(): void; onLabels(values: Record<string, string>): void;
}) {
  const host = useHost();
  const store = useVela();
  const look = useLook();
  const model = host.env.library!.model!;
  const libraryId = model.id;
  const [query, setQuery] = useState('');
  const [values, setValues] = useState<FacetValue[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useState(0);
  const generation = useRef(0);
  const labels = useRef(onLabels); labels.current = onLabels;
  useEffect(() => {
    let active = true;
    const leave = new AbortController();
    generation.current++;
    setLoading(true); setFailed(false);
    const timer = setTimeout(() => {
      void store.catalogue.libraryFacets(libraryId, facet.id, query, undefined, leave.signal).then(page => {
        if (!active) return;
        setValues(page.items); setCursor(page.nextCursor);
        labels.current(Object.fromEntries(page.items.map(v => [v.id, v.label])));
      }).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; leave.abort(); generation.current++; clearTimeout(timer); };
  }, [store, libraryId, facet.id, query, attempt]);
  function choose(id: string) {
    const next = { ...model.facetFilters };
    const current = next[facet.id] ?? [];
    next[facet.id] = current.includes(id) ? current.filter(value => value !== id) : facet.multi ? [...current, id] : [id];
    if (!next[facet.id]!.length) delete next[facet.id];
    host.dispatch('libraryFilter', `facets|${JSON.stringify(next)}`);
  }
  return <>
    <PanelHeader title={facet.label} onDone={onClose} back={{ label: msg('library.filters'), onPress: onBack }} />
    <TextField accessibilityLabel={msg('library.facetSearch', { facet: facet.label })} placeholder={msg('library.facetSearch', { facet: facet.label })} placeholderTextColor={look.ui.inkSecondary} value={query} onChangeText={setQuery}
      style={[look.text({}), look.box({ height: '$ui.controlHeight', padding: '0px 12px', border: '1px solid $ui.glassEdge', 'border-radius': '$ui.radiusControl', 'background-color': '$ui.control' }), { flexShrink: 0 }, Platform.OS === 'web' && { fontSize: 16 }]} />
    {loading && !values.length ? <ContentLoader inline={false} /> : failed ? <View style={{ flexDirection: 'row' }}><Button label={msg('ui.tryAgain')} onPress={() => retry(v => v + 1)} /></View> : <>
      {!values.length && <Text style={look.text({ color: '$ui.inkSecondary' })}>{msg('library.facetNone')}</Text>}
      <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 2 }}>
        {values.map(value => <ValueRow key={value.id} label={value.label} count={value.count} multi={!!facet.multi} selected={selected.includes(value.id)} onPress={() => choose(value.id)} />)}
        {loading && <ContentLoader inline />}
        {cursor && !loading && <Button label={msg('library.facetMore')} quiet onPress={() => {
          const request = generation.current;
          setLoading(true);
          void store.catalogue.libraryFacets(libraryId, facet.id, query, cursor).then(page => {
            if (request !== generation.current) return;
            setValues(previous => [...new Map([...previous, ...page.items].map(value => [value.id, value])).values()]); setCursor(page.nextCursor);
            labels.current(Object.fromEntries(page.items.map(v => [v.id, v.label])));
          }).catch(() => { if (request === generation.current) setFailed(true); }).finally(() => { if (request === generation.current) setLoading(false); });
        }} />}
      </ScrollView>
    </>}
  </>;
}

/** One letter tile inside the Jump panel. */
function JumpTile({ bucket, selected, preferred, onPress }: {
  bucket: LibraryJumpBucket; selected: boolean; preferred: boolean; onPress(): void;
}) {
  const look = useLook();
  const [focused, focus] = useState(false);
  const claim = useFocusClaim(preferred);
  return <FocusPressable testID={`library-jump-${bucket.key}`} accessibilityRole="radio"
    accessibilityLabel={`${bucket.label}, ${number(bucket.count)}`}
    accessibilityState={{ selected, checked: selected }}
    {...(Platform.OS === 'web' ? { 'aria-checked': selected } : {})}
    hasTVPreferredFocus={claim} onFocus={() => focus(true)} onBlur={() => focus(false)} onPress={onPress}
    style={look.box({
      'min-width': Platform.isTV ? '64px' : '46px',
      height: Platform.isTV ? '56px' : '42px',
      padding: '0px 10px',
      'border-radius': '$ui.radiusControl',
      'background-color': selected ? '$ui.accent' : focused ? '$ui.controlHover' : '$ui.control',
      border: `1px solid ${focused && selected ? '$ui.ink' : focused ? '$ui.accent' : selected ? '$ui.accent' : '$ui.glassEdge'}`,
      'align-items': 'center',
      'justify-content': 'center',
    })}>
    <Text accessible={false} numberOfLines={1}
      style={[look.text({ color: selected ? '$ui.onAccent' : '$ui.ink', 'font-size': Platform.isTV ? '20px' : '$ui.controlFontSize', 'font-weight': '700' }), CENTRED]}>
      {bucket.label}
    </Text>
  </FocusPressable>;
}

/** First-character jump index in server title-sort order. Picking a letter jumps straight to its offset. */
export function JumpPanel({ anchor, onClose, onJump }: { anchor?: Anchor; onClose(): void; onJump(startOffset: number): void }) {
  const host = useHost();
  const page = host.env.library;
  const buckets = page?.jumpBuckets;
  if (!buckets?.length) return null;
  const active = activeJumpBucket(buckets, page?.jumpStart);
  const preferredKey = active?.key ?? buckets[0]?.key;
  const choose = (startOffset: number) => {
    const target = startOffset > 0 ? startOffset : 0;
    host.dispatch('libraryFilter', target > 0 ? `start|${target}` : 'start|');
    onJump(target);
    onClose();
  };
  return <Panel label={msg('library.jumpTitle')} anchor={anchor} onClose={onClose} width={416}>
    <PanelHeader title={msg('library.jumpTitle')} onDone={onClose} />
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 2 }}>
      {buckets.map(bucket => <JumpTile key={bucket.key} bucket={bucket}
        selected={active ? active.key === bucket.key : bucket.startOffset === 0}
        preferred={bucket.key === preferredKey}
        onPress={() => choose(bucket.startOffset)} />)}
    </ScrollView>
    {!!page?.jumpStart && <View style={{ flexDirection: 'row', justifyContent: 'flex-start' }}>
      <Button testID="library-jump-top" label={msg('library.jumpTop')} quiet onPress={() => choose(0)} />
    </View>}
  </Panel>;
}

/** The sorts a library offers, and the direction when the sort in force has two. */
export function SortPanel({ anchor, onClose }: { anchor?: Anchor; onClose(): void }) {
  const host = useHost();
  const model = host.env.library?.model;
  if (!model) return null;
  const current = model.sorts.find(sort => sort.id === model.sort);
  return <Panel label={msg('library.sort')} anchor={anchor} onClose={onClose} width={320}>
    <PanelHeader title={msg('library.sort')} onDone={onClose} />
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 18 }}>
      <Section title={msg('library.sortBy')}>
        {model.sorts.map(sort => <Button key={sort.id} role="radio" label={sort.label} selected={model.sort === sort.id} onPress={() => host.dispatch('librarySort', sort.id)} />)}
      </Section>
      {current?.directions.length === 2 && <Section title={msg('library.order')}>
        <Button role="radio" label={msg('library.ascending')} selected={model.direction === 'asc'} onPress={() => { if (model.direction !== 'asc') host.dispatch('librarySortFlip', ''); }} />
        <Button role="radio" label={msg('library.descending')} selected={model.direction === 'desc'} onPress={() => { if (model.direction !== 'desc') host.dispatch('librarySortFlip', ''); }} />
      </Section>}
    </ScrollView>
  </Panel>;
}
