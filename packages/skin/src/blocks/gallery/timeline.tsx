import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { FlatList, Platform, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { localeContext, msg, number, plural, type Card } from '@vela/core';
import { useScreenBusy } from '@vela/core/react';
import { FocusPressable } from '../../focus';
import { useHost } from '../../host';
import type { Props } from '../rich';
import { useInteraction } from '../../widgets/common/controls';
import { useBlockLook } from '../look';
import { usePart, usePartStyler } from '../listen/look';
import { useMediaLook } from '../media/parts';
import { photoRows, timelineRows, type TimelineRow } from './timeline-layout';

export function GalleryGridBlock({ props, items, pageKey, directory = false }: { props: Props; items: Card[]; pageKey: string; directory?: boolean }) {
  const host = useHost();
  const m = useMediaLook();
  const month = usePart('timeline.month');
  const day = usePart('timeline.day');
  const look = useBlockLook();
  const tv = look.tv;
  const directoryKind = directory ? props.enum('kind', ['albums', 'people'] as const) : undefined;
  const groupByDate = !directory && props.bool('groupByDate');
  const labelHeight = directory ? look.px(tv ? 62 : 52) : 0;
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
    dayFormat: new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
  }), [locale]);
  const gap = look.px(directory ? 16 : tv ? 12 : 4);
  const tileWidth = look.px(directory ? tv ? 176 : m.small ? 116 : 148 : tv ? 152 : m.small ? 86 : 131);
  const columns = Math.max(1, Math.floor((width + gap) / (tileWidth + gap)));
  const size = Math.max(0, Math.floor((width - (columns - 1) * gap) / columns));
  const rowHeight = size + gap + labelHeight;
  const focusRoom = tv ? Math.ceil(gap / 2) : 0;
  const rows = useMemo(() => groupByDate ? timelineRows(items, columns) : photoRows(items, columns), [items, columns, groupByDate]);
  const firstPhoto = rows.findIndex(row => row.kind === 'photos');
  const layout = useMemo(() => {
    let offset = focusRoom;
    return rows.map((row, index) => {
      const length = row.kind === 'month' ? 59 : row.kind === 'day' ? 36 : rowHeight;
      const item = { index, length, offset };
      offset += length;
      return item;
    });
  }, [rows, rowHeight, focusRoom]);
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
    let frame = 0;
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
        cancelAnimationFrame(frame);
        let attempts = 0;
        const focus = () => {
          const rendered = node?.querySelector<HTMLElement>(selector);
          if (rendered) rendered.focus();
          else if (++attempts < 15) frame = requestAnimationFrame(focus);
        };
        frame = requestAnimationFrame(focus);
      }
    };
    node?.addEventListener('keydown', move);
    return () => {
      cancelAnimationFrame(frame);
      node?.removeEventListener('keydown', move);
    };
  }, [rows]);

  if (failed === 'unsupported') return null;
  return (
    <View style={{ flex: 1, minHeight: 0, paddingHorizontal: look.gutter }}>
      <View ref={root} onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ flex: 1, minHeight: 0 }} testID={directoryKind ? `gallery-${directoryKind}` : 'gallery-timeline'}>
        {size > 0 ? <FlatList
          ref={list} style={{ flex: 1, marginHorizontal: -focusRoom }}
          contentContainerStyle={{ paddingHorizontal: focusRoom, paddingVertical: focusRoom }}
          data={rows} keyExtractor={row => row.key}
          getItemLayout={(_rows, index) => layout[index]!} initialNumToRender={12} windowSize={7}
          onEndReached={() => loadMore()} onEndReachedThreshold={0.8}
          ListEmptyComponent={!pending && !failed && !more ? <Text style={m.text({ color: '$ui.inkQuiet' })}>{msg(directoryKind ? `gallery.empty.${directoryKind}` : 'gallery.empty')}</Text> : undefined}
          ListFooterComponent={pending || busy ? (
            <Text accessibilityLiveRegion="polite" style={m.text({ color: '$ui.inkQuiet' })}>
              {msg(directory ? 'gallery.loadingDirectory' : 'gallery.loading')}
            </Text>
          ) : source && (pageFailed || more) ? (
            <FocusPressable onPress={() => loadMore(true)} accessibilityRole="button" style={{ alignSelf: 'center', padding: 16 }}>
              <Text style={m.text({ color: '$ui.ink' })}>{msg(pageFailed ? 'ui.tryAgain' : 'library.loadMore')}</Text>
            </FocusPressable>
          ) : undefined}
          renderItem={({ item, index }) => {
            if (item.kind !== 'photos') {
              const part = item.kind === 'month' ? month : day;
              const date = item.date ? new Date(item.kind === 'month' ? `${item.date}-01` : item.date) : null;
              const format = item.kind === 'month' ? monthFormat : dayFormat;
              return <View style={[{ justifyContent: 'center' }, part.box, { height: layout[index]!.length }]}>
                <Text accessibilityRole="header" {...(Platform.OS === 'web' ? { 'aria-level': item.kind === 'month' ? 2 : 3 } : {})} numberOfLines={1} style={[m.text({ 'font-size': item.kind === 'month' ? '25px' : '15px', 'font-weight': '650', color: '$ui.ink' }), part.text]}>{date ? format.format(date) : msg('gallery.undated')}</Text>
              </View>;
            }
            return <View style={{ flexDirection: 'row', gap, height: rowHeight }}>
              {item.photos.map((photo, column) => (
                <GalleryTile key={photo.id} card={photo} size={size} focusRoom={focusRoom} row={index} column={column}
                  labelHeight={labelHeight} directory={directoryKind} preferred={index === firstPhoto && column === 0}
                  onPress={() => {
                    if (!directoryKind) { host.dispatch('select', photo.id); return; }
                    const page = directoryKind === 'albums' ? 'album' : 'person';
                    host.screenPress?.({ action: 'navigate', arg: '', args: { page, id: photo.id, name: photo.name }, control: `gallery-${page}-${photo.id}` });
                  }} />
              ))}
            </View>;
          }}
        /> : null}
      </View>
    </View>
  );
}

type DirectoryKind = 'albums' | 'people';

function GalleryTile({ card, size, focusRoom, row, column, preferred, labelHeight, directory, onPress }: {
  card: Card; size: number; focusRoom: number; row: number; column: number; preferred: boolean;
  labelHeight: number; directory?: DirectoryKind; onPress(): void;
}) {
  const host = useHost();
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const style = usePartStyler([directory ? 'galleryDirectory.tile' : 'timeline.tile']);
  const nameStyle = usePart('galleryDirectory.name').text;
  const countStyle = usePart('galleryDirectory.count').text;
  const total = card.media?.childCount ?? 0;
  const count = directory === 'people' ? card.facts
    : directory === 'albums' ? msg(`gallery.photoCount.${plural(total)}`, { count: number(total) }) : '';
  const radius = directory === 'people' ? size / 2 : directory ? m.box({ 'border-radius': '$ui.radiusCard' }).borderRadius : 0;
  const label = count ? `${card.name}, ${count}` : card.name;
  // A focused TV photo grows within half the gap. Directory labels keep their fixed size.
  const scale = Platform.isTV && focusRoom && !directory && state.focus && !host.env.still ? 1 + focusRoom / size : 1;
  return (
    <FocusPressable {...handlers} accessibilityRole="button" accessibilityLabel={label}
      testID={`gallery-${directory === 'people' ? 'person' : directory === 'albums' ? 'album' : 'photo'}-${card.id}`}
      hasTVPreferredFocus={Platform.isTV && preferred}
      {...(Platform.OS === 'web' ? { dataSet: { galleryRow: row, galleryColumn: column } } : {})}
      onPress={onPress}
      style={[{ width: size, height: size + labelHeight, borderRadius: radius, transform: [{ scale }] }, style?.({ focus: state.focus, hover: state.hover })]}>
      <View style={{ height: size, borderRadius: radius, backgroundColor: m.ui.raised, overflow: 'hidden', alignItems: 'stretch', justifyContent: 'center' }}>
        {card.poster ? <Image source={host.image(card.poster)} contentFit="cover" recyclingKey={card.id} style={{ flex: 1 }} />
          : <Text numberOfLines={1} style={m.text({ 'text-align': 'center', color: '$ui.inkQuiet' })}>{card.name}</Text>}
        {Platform.isTV && state.focus ? <View pointerEvents="none" style={{ position: 'absolute', inset: 0, borderRadius: radius, borderWidth: 3, borderColor: m.ui.ink }} /> : null}
      </View>
      {directory ? <View style={{ height: labelHeight, alignItems: directory === 'people' ? 'center' : 'flex-start', justifyContent: 'center' }}>
        <Text numberOfLines={1} style={[m.text({ 'font-size': '16px', 'font-weight': '650', color: '$ui.ink' }), nameStyle]}>{card.name}</Text>
        {count ? <Text numberOfLines={1} style={[m.text({ 'font-size': '13px', color: '$ui.inkQuiet' }), countStyle]}>{count}</Text> : null}
      </View> : null}
    </FocusPressable>
  );
}
