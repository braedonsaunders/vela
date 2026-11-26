import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { FlatList, Platform, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { localeContext, msg, type Card } from '@vela/core';
import { useScreenBusy } from '@vela/core/react';
import { FocusPressable } from '../../focus';
import { useHost } from '../../host';
import type { Props } from '../rich';
import { usePart } from '../listen/look';
import { useMediaLook } from '../media/parts';
import { timelineRows, type TimelineRow } from './timeline-layout';

export function TimelineBlock({ props, items, pageKey }: { props: Props; items: Card[]; pageKey: string }) {
  const host = useHost();
  const m = useMediaLook();
  const month = usePart('timeline.month');
  const day = usePart('timeline.day');
  const tile = usePart('timeline.tile');
  const [width, setWidth] = useState(0);
  const raw = props.value('items');
  const source = props.text('source');
  const pending = props.bool('pending');
  const failed = props.text('failed');
  const more = !!(raw && typeof raw === 'object' && 'more' in raw && raw.more === true);
  const control = `gallery-more-${source}`;
  const busy = useScreenBusy(pageKey, control);
  const [requested, setRequested] = useState<unknown>();
  const pageFailed = !!failed || (!busy && requested !== undefined && requested === raw);
  const locale = localeContext().formatLocale;
  const { monthFormat, dayFormat } = useMemo(() => ({
    monthFormat: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    dayFormat: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  }), [locale]);
  const gap = Platform.isTV ? 8 : 4;
  const columns = Math.max(1, Math.floor((width + gap) / (Platform.isTV ? 158 : m.small ? 91 : 135)));
  const size = Math.max(0, Math.floor((width - (columns - 1) * gap) / columns));
  const rows = useMemo(() => timelineRows(items, columns), [items, columns]);
  const firstPhoto = rows.findIndex(row => row.kind === 'photos');
  const layout = useMemo(() => {
    let offset = 0;
    return rows.map((row, index) => {
      const length = row.kind === 'month' ? 59 : row.kind === 'day' ? 36 : size + gap;
      const item = { index, length, offset };
      offset += length;
      return item;
    });
  }, [rows, size, gap]);
  const root = useRef<ComponentRef<typeof View>>(null);
  const list = useRef<FlatList<TimelineRow<Card>>>(null);

  function loadMore(retry = false) {
    if (!source || pending || busy || !host.screenPress || !retry && (!more || pageFailed)) return;
    if (!raw && retry) {
      host.screenPress({ action: 'retry', arg: '', args: { source }, control });
      return;
    }
    setRequested(raw);
    host.screenPress({ action: 'plugin', arg: '', args: { name: 'vela.more', source }, control });
  }

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = root.current as unknown as HTMLElement | null;
    const move = (event: KeyboardEvent) => {
      const cell = (event.target as HTMLElement)?.closest<HTMLElement>('[data-gallery-row]');
      const direction = event.key.replace(/^Arrow/, '');
      if (!cell || !['Up', 'Down', 'Left', 'Right'].includes(direction)) return;
      const rowIndex = Number(cell.dataset.galleryRow);
      const column = Number(cell.dataset.galleryColumn);
      const vertical = direction === 'Up' || direction === 'Down';
      const step = direction === 'Left' || direction === 'Up' ? -1 : 1;
      let targetRow = rowIndex + (vertical ? step : 0);
      while (rows[targetRow] && rows[targetRow]?.kind !== 'photos') targetRow += step;
      const row = rows[targetRow];
      event.preventDefault();
      if (row?.kind !== 'photos') return;
      const targetColumn = vertical ? Math.min(column, row.photos.length - 1) : column + step;
      if (!row.photos[targetColumn]) return;
      const selector = `[data-gallery-row="${targetRow}"][data-gallery-column="${targetColumn}"]`;
      const target = node?.querySelector<HTMLElement>(selector);
      if (target) target.focus();
      else {
        list.current?.scrollToIndex({ index: targetRow, animated: false });
        requestAnimationFrame(() => node?.querySelector<HTMLElement>(selector)?.focus());
      }
    };
    node?.addEventListener('keydown', move);
    return () => node?.removeEventListener('keydown', move);
  }, [rows]);

  if (failed === 'unsupported') return null;
  return (
    <View ref={root} onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ flex: 1, minHeight: 0 }} testID="gallery-timeline">
      {size > 0 ? <FlatList
        ref={list} style={{ flex: 1 }} data={rows} keyExtractor={row => row.key}
        getItemLayout={(_rows, index) => layout[index]!} initialNumToRender={12} windowSize={7}
        onEndReached={() => loadMore()} onEndReachedThreshold={0.8}
        ListEmptyComponent={!pending && !failed && !more ? <Text style={m.text({ color: '$ui.inkQuiet' })}>{msg('gallery.empty')}</Text> : undefined}
        ListFooterComponent={pageFailed && source ? (
          <FocusPressable onPress={() => loadMore(true)} accessibilityRole="button" style={{ alignSelf: 'center', padding: 16 }}>
            <Text style={m.text({ color: '$ui.ink' })}>{msg('ui.tryAgain')}</Text>
          </FocusPressable>
        ) : pending || more ? <Text accessibilityLiveRegion="polite" style={m.text({ color: '$ui.inkQuiet' })}>{msg('gallery.loading')}</Text> : undefined}
        renderItem={({ item, index }) => {
          if (item.kind !== 'photos') {
            const part = item.kind === 'month' ? month : day;
            const date = item.date ? new Date(item.kind === 'month' ? `${item.date}-01` : item.date) : null;
            const format = item.kind === 'month' ? monthFormat : dayFormat;
            return <View style={[{ justifyContent: 'center' }, part.box, { height: layout[index]!.length }]}>
              <Text accessibilityRole="header" numberOfLines={1} style={[m.text({ 'font-size': item.kind === 'month' ? '25px' : '15px', 'font-weight': '650', color: '$ui.ink' }), part.text]}>{date ? format.format(date) : msg('gallery.undated')}</Text>
            </View>;
          }
          return <View style={{ flexDirection: 'row', gap, height: size + gap }}>
            {item.photos.map((photo, column) => (
              <FocusPressable key={photo.id} accessibilityRole="button" accessibilityLabel={photo.name}
                testID={`gallery-photo-${photo.id}`} hasTVPreferredFocus={Platform.isTV && index === firstPhoto && column === 0}
                {...(Platform.OS === 'web' ? { dataSet: { galleryRow: index, galleryColumn: column } } : {})}
                onPress={() => host.dispatch('select', photo.id)}
                style={({ focused }: { focused?: boolean }) => [tile.box, { width: size, height: size, overflow: 'hidden',
                  backgroundColor: m.ui.raised, borderWidth: Platform.isTV ? 3 : 0, borderColor: focused ? m.ui.ink : 'transparent' }]}>
                {photo.poster ? <Image source={photo.poster} contentFit="cover" recyclingKey={photo.id} style={{ flex: 1 }} /> : null}
              </FocusPressable>
            ))}
          </View>;
        }}
      /> : null}
    </View>
  );
}
