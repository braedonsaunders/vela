import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useVela } from '@vela/core/react';
import { libraryTabs } from '@vela/core';
import type { FacetValue, LibraryFacet } from '../../../../protocol/types';
import { FocusPressable } from '../../focus';
import { useHost } from '../../host';
import { holdBack } from '../../menu-key';
import { useFocusClaim } from '../common/focus-claim';
import { useLook } from '../common/look';
import { TextField } from '../common/text-field';

function Button({ label, onPress, selected = false, role = 'button', id, quiet = false, preferred = false }: {
  id?: string; label: string; onPress(): void; selected?: boolean; quiet?: boolean; preferred?: boolean; role?: 'button' | 'tab' | 'checkbox';
}) {
  const look = useLook();
  const [focused, focus] = useState(false);
  const claim = useFocusClaim(preferred);
  const tab = role === 'tab';
  return <FocusPressable nativeID={id} accessibilityRole={role} accessibilityLabel={label} accessibilityState={{ selected, checked: role === 'checkbox' ? selected : undefined }}
    {...(Platform.OS === 'web' ? { 'aria-selected': tab ? selected : undefined, 'aria-checked': role === 'checkbox' ? selected : undefined } : {})}
    hasTVPreferredFocus={claim} onFocus={() => focus(true)} onBlur={() => focus(false)} onPress={onPress}
    style={look.box({ position: 'relative', 'flex-shrink': '0', 'align-self': 'flex-start', 'min-height': '36px', 'justify-content': 'center', padding: '8px 12px', 'border-radius': '$ui.radiusControl',
      'background-color': focused ? '$ui.controlHover' : selected ? '$ui.control' : quiet || tab ? 'transparent' : '$ui.raised',
      border: `1px solid ${focused ? '$ui.accent' : quiet || tab ? 'transparent' : selected ? '$ui.glassEdgeStrong' : '$ui.glassEdge'}` })}>
    <Text numberOfLines={1} style={look.text({ color: tab && selected ? '$ui.accent' : quiet ? '$ui.inkSecondary' : '$ui.ink', 'font-size': '14px', 'font-weight': tab && selected ? '650' : '500' })}>
      {role === 'checkbox' && selected ? '✓ ' : ''}{label}
    </Text>
    {tab && selected && <View style={look.box({ position: 'absolute', bottom: '0px', left: '12px', right: '12px', height: '2px', 'border-radius': '1px', 'background-color': '$ui.accent' })} />}
  </FocusPressable>;
}

export function LibraryTabs() {
  const host = useHost();
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 4 }}>
    {libraryTabs(host.env.library?.model?.tabs)?.map(tab => <Button key={tab.id} id={`vela-library-view-${tab.id}`} role="tab" label={tab.label}
      selected={host.env.library?.tabId === tab.id} onPress={() => host.dispatch('libraryView', tab.id)} />)}
  </ScrollView>;
}

export function LibraryFacets() {
  const host = useHost();
  const store = useVela();
  const model = host.env.library?.model;
  const look = useLook();
  const phone = host.viewport.width < 600 && !Platform.isTV;
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
    style={[look.text({ color: '$ui.ink', 'font-size': '14px' }), look.box({ width: phone ? '100%' : '220px', height: '36px', padding: '8px 12px', 'background-color': '$ui.raised', border: '1px solid $ui.glassEdge', 'border-radius': '$ui.radiusControl', 'flex-shrink': '0' })]} />;
  function choose(facet: LibraryFacet, id: string) {
    const next = { ...model!.facetFilters };
    const selected = next[facet.id] ?? [];
    next[facet.id] = selected.includes(id) ? selected.filter(value => value !== id) : facet.multi ? [...selected, id] : [id];
    if (!next[facet.id].length) delete next[facet.id];
    host.dispatch('libraryFilter', `facets|${JSON.stringify(next)}`);
  }
  const active = model.facets?.flatMap(facet => (model.facetFilters?.[facet.id] ?? []).map(id => ({ facet, id }))) ?? [];
  return <View style={{ gap: 8, paddingBottom: 10 }}>
    {phone && searchField}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {!phone && searchField}
      {model.facets?.map(facet => <Button key={facet.id} label={facet.label} selected={open?.id === facet.id} onPress={() => setOpen(facet)} />)}
      {active.map(({ facet, id }) => <Button key={`${facet.id}:${id}`} label={`${labels[facet.id]?.[id] ?? id} ×`} selected onPress={() => choose(facet, id)} />)}
      {!!active.length && <Button label="Clear filters" quiet onPress={() => host.dispatch('libraryFilter', 'facets|{}')} />}
    </ScrollView>
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
  const [loading, setLoading] = useState(false);
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
          style={[look.text({}), look.box({ height: '40px', padding: '8px 12px', border: '1px solid $ui.glassEdge', 'border-radius': '$ui.radiusControl' })]} />
        {loading ? <Text style={look.text({})}>Loading…</Text> : failed ? <Button label="Retry" onPress={() => retry(v => v + 1)} /> : <>
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
