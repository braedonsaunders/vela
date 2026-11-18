import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { useVela } from '@vela/core/react';
import { libraryTabs } from '@vela/core';
import type { FacetValue, LibraryFacet } from '../../../../protocol/types';
import { FocusPressable } from '../../focus';
import { useHost } from '../../host';
import { useLook } from '../common/look';
import { TextField } from '../common/text-field';

function Button({ label, onPress, selected = false, role = 'button', id }: { id?: string; label: string; onPress(): void; selected?: boolean; role?: 'button' | 'tab' | 'checkbox' }) {
  const look = useLook();
  const [focused, focus] = useState(false);
  return <FocusPressable nativeID={id} accessibilityRole={role} accessibilityLabel={label} accessibilityState={{ selected, checked: role === 'checkbox' ? selected : undefined }}
    {...(Platform.OS === 'web' ? { 'aria-selected': role === 'tab' ? selected : undefined, 'aria-checked': role === 'checkbox' ? selected : undefined } : {})}
    onFocus={() => focus(true)} onBlur={() => focus(false)} onPress={onPress}
    style={look.box({ padding: '10px 14px', 'border-radius': '$ui.radiusControl', 'background-color': selected || focused ? '$ui.control' : '$ui.raised', 'border-width': '2px', 'border-color': focused ? '$ui.accent' : '$ui.glassEdge' })}>
    <Text style={look.text({ color: '$ui.ink', 'font-size': '14px' })}>{role === 'checkbox' && selected ? '✓ ' : ''}{label}</Text>
  </FocusPressable>;
}
export function LibraryTabs() {
  const host = useHost();
  return <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{libraryTabs(host.env.library?.model?.tabs)?.map(tab =>
    <Button key={tab.id} id={`vela-library-view-${tab.id}`} role="tab" label={tab.label} selected={host.env.library?.tabId === tab.id} onPress={() => host.dispatch('libraryView', tab.id)} />)}</View>;
}

export function LibraryFacets() {
  const host = useHost();
  const model = host.env.library?.model;
  const look = useLook();
  const [search, setSearch] = useState(model?.query ?? '');
  useEffect(() => setSearch(model?.query ?? ''), [model?.query]);
  useEffect(() => {
    const timer = setTimeout(() => { if (search !== (model?.query ?? '')) host.dispatch('libraryFilter', `query|${search}`); }, 350);
    return () => clearTimeout(timer);
  }, [search, model?.query, host.dispatch]);
  if (!model?.canSearch) return null;
  return <View style={{ gap: 10, paddingBottom: 14 }}>
    <TextField accessibilityLabel="Search this library" placeholder="Search this library" placeholderTextColor={look.ui.inkSecondary} value={search} onChangeText={setSearch}
      style={[look.text({ color: '$ui.ink', 'font-size': '16px' }), look.box({ padding: '12px', 'background-color': '$ui.raised', 'border-radius': '$ui.radiusControl' })]} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{model.facets?.map(facet => <Facet key={`${model.id}:${facet.id}`} facet={facet} />)}</View>
    {!!Object.values(model.facetFilters ?? {}).flat().length && <Button label="Clear filters" onPress={() => host.dispatch('libraryFilter', 'facets|{}')} />}
  </View>;
}
function Facet({ facet }: { facet: LibraryFacet }) {
  const host = useHost();
  const store = useVela();
  const look = useLook();
  const model = host.env.library!.model!;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [values, setValues] = useState<FacetValue[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useState(0);
  const generation = useRef(0);
  const selected = model.facetFilters?.[facet.id] ?? [];
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open && !selected.length) return;
    let active = true;
    generation.current++;
    setLoading(true); setFailed(false);
    const timer = setTimeout(() => {
      void store.catalogue.libraryFacets(model.id, facet.id, query).then(page => {
        if (!active) return;
        setValues(page.items); setCursor(page.nextCursor);
        setLabels(previous => ({ ...previous, ...Object.fromEntries(page.items.map(v => [v.id, v.label])) }));
      }).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; generation.current++; clearTimeout(timer); };
  }, [store, model.id, facet.id, open, query, attempt]);
  function choose(id: string) {
    const next = { ...model.facetFilters };
    next[facet.id] = selected.includes(id) ? selected.filter(value => value !== id) : facet.multi ? [...selected, id] : [id];
    if (!next[facet.id].length) delete next[facet.id];
    host.dispatch('libraryFilter', `facets|${JSON.stringify(next)}`);
  }
  return <View style={{ gap: 6, minWidth: 160, maxWidth: '100%' }}>
    <Button label={`${facet.label}${selected.length ? ` (${selected.length})` : ''}`} selected={open} onPress={() => setOpen(!open)} />
    {selected.map(id => <Button key={id} label={`${labels[id] ?? id} ×`} selected onPress={() => choose(id)} />)}
    {open && <View style={{ gap: 6 }}>
      <TextField accessibilityLabel={`Search ${facet.label}`} placeholder={`Search ${facet.label}`} placeholderTextColor={look.ui.inkSecondary} value={query} onChangeText={setQuery} style={[look.text({}), { padding: 12 }]} />
      {loading ? <Text style={look.text({})}>Loading…</Text> : failed ? <Button label="Retry" onPress={() => retry(v => v + 1)} /> : <>
        {!values.length && <Text style={look.text({})}>No values</Text>}
        <ScrollView style={{ maxHeight: 240 }} contentContainerStyle={{ gap: 6 }}>{values.map(value => <Button key={value.id} role="checkbox" label={`${value.label} (${value.count})`} selected={selected.includes(value.id)} onPress={() => choose(value.id)} />)}</ScrollView>
        {cursor && <Button label="More values" onPress={() => {
          const request = generation.current;
          setLoading(true);
          void store.catalogue.libraryFacets(model.id, facet.id, query, cursor).then(page => {
            if (request !== generation.current) return;
            setValues(previous => [...new Map([...previous, ...page.items].map(value => [value.id, value])).values()]); setCursor(page.nextCursor);
            setLabels(previous => ({ ...previous, ...Object.fromEntries(page.items.map(v => [v.id, v.label])) }));
          }).catch(() => { if (request === generation.current) setFailed(true); }).finally(() => { if (request === generation.current) setLoading(false); });
        }} />}
      </>}
    </View>}
  </View>;
}
