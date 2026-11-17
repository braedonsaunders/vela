// The EPG grid: one panel that scrolls on both axes, with a time ruler that follows it sideways,
// a channel rail that follows it down, half-hour lines, the past dimmed and a now line. Rows are
// virtualized and each row draws only the programmes near the visible time, so a lineup of
// hundreds over a whole day scrolls as smoothly as a dozen. On the web, arrow keys walk the grid
// (Enter watches what is airing); TV focus engines walk it natively.
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { FlatList, Platform, View, type LayoutChangeEvent } from 'react-native';
import Animated, { runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { msg, type GuideChannel, type GuideModel, type GuideProgramme } from '@vela/core';
import { cellId, leftFor, minuteWidth, programmeAt, railId, railWidth, rowHeight, RULER, type Zoom } from './geometry';
import type { GuideLook } from './look';
import { RailCell } from './rail';
import { Ruler } from './ruler';
import { TimelineRow } from './timeline-row';

export interface GridHandle {
  /** Bring now into view; false when the shown day is not today. */
  jumpNow(): boolean;
  /** Step the time by hours; the day before or after when that runs off this one. */
  shift(hours: number): -1 | 0 | 1;
}

export interface GridProps {
  look: GuideLook;
  model: GuideModel;
  rows: GuideChannel[];
  small: boolean;
  zoom: Zoom;
  still: boolean;
  selected: { channel: string; programme: string };
  /** Where to open: a time of day, and a channel to bring into view (a search hand-off). */
  landing: { minute: number; channelId: string };
  onSelect(channel: GuideChannel, programme: GuideProgramme | null): void;
  onPress(channel: GuideChannel, programme: GuideProgramme): void;
  onWatch(channelId: string): void;
  onVisible(ids: string[]): void;
  onRange(from: number, to: number): void;
  handle: Ref<GridHandle>;
}

/** Programmes this far either side of the visible time are drawn ahead of a scroll. */
const MARGIN = 150;

export function GuideGrid(props: GridProps) {
  const { look, model, rows, small, zoom, still, selected, landing } = props;
  const scale = minuteWidth(small, zoom);
  const row = rowHeight(small, Platform.isTV);
  const rail = railWidth(small, Platform.isTV);
  const width = model.minutes * scale;
  const [body, setBody] = useState({ width: 0, height: 0 });
  const visibleMinutes = Math.max(30, (body.width - rail) / scale);

  const scrollX = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const lastColumn = useSharedValue(-1);
  const lastRowBucket = useSharedValue(-1);
  const [column, setColumn] = useState(-1);
  const focusRow = landing.channelId ? rows.findIndex(c => c.id === landing.channelId) : -1;
  const [rowBase, setRowBase] = useState(() => Math.max(0, focusRow - 1));
  const timeline = useRef<Animated.ScrollView>(null);
  const list = useRef<FlatList<GuideChannel>>(null);
  const landed = useRef(false);
  const lastScale = useRef(scale);
  const focusMinute = useRef(-1);

  const onTimeline = useAnimatedScrollHandler(
    {
      onScroll: e => {
        scrollX.value = e.contentOffset.x;
        const next = Math.floor(e.contentOffset.x / scale / 30);
        if (next !== lastColumn.value) { lastColumn.value = next; runOnJS(setColumn)(next); }
      },
    },
    [scale],
  );
  const onRows = useAnimatedScrollHandler(
    {
      onScroll: e => {
        scrollY.value = e.contentOffset.y;
        const next = Math.floor(e.contentOffset.y / row / 4) * 4;
        if (next !== lastRowBucket.value) { lastRowBucket.value = next; runOnJS(setRowBase)(next); }
      },
    },
    [row],
  );

  const scrollTo = useCallback(
    (minute: number, animated: boolean) => {
      const x = Math.max(0, Math.min(width - (body.width - rail), minute * scale));
      timeline.current?.scrollTo({ x, animated: animated && !still });
      if (!animated || still) {
        scrollX.value = x;
        setColumn(Math.floor(x / scale / 30));
      }
    },
    [width, body.width, rail, scale, still, scrollX],
  );

  // Open with the landing time a third of the way across, so the past reads to its left.
  useEffect(() => {
    if (landed.current || body.width === 0) return;
    landed.current = true;
    scrollTo(leftFor(landing.minute, visibleMinutes, model.minutes), false);
  }, [body.width, landing.minute, visibleMinutes, model.minutes, scrollTo]);

  // Zooming keeps the time at the panel's left edge where it was.
  useLayoutEffect(() => {
    if (lastScale.current === scale) return;
    const minute = scrollX.value / lastScale.current;
    lastScale.current = scale;
    scrollTo(minute, false);
  }, [scale, scrollTo, scrollX]);

  useImperativeHandle(
    props.handle,
    () => ({
      jumpNow() {
        if (model.nowMinute < 0) return false;
        scrollTo(leftFor(model.nowMinute, visibleMinutes, model.minutes), true);
        return true;
      },
      shift(hours) {
        const target = Math.floor(scrollX.value / scale / 30) * 30 + hours * 60;
        if (target < 0 && model.day > 0) return -1;
        if (target > model.minutes - 60 && model.day < model.days.length - 1) return 1;
        scrollTo(Math.max(0, Math.min(model.minutes - 30, target)), true);
        return 0;
      },
    }),
    [model, visibleMinutes, scale, scrollTo, scrollX],
  );

  const leftMinute = Math.max(0, column) * 30;
  const window = { from: leftMinute - MARGIN, to: leftMinute + visibleMinutes + MARGIN };
  /** Web keyboard: move focus through the grid, bringing the target into view first. */
  const onKey = (channel: GuideChannel, p: GuideProgramme, key: string, prevent: () => void) => {
    if (key === 'Enter' && p.airing) {
      prevent();
      props.onWatch(channel.id);
      return;
    }
    const index = rows.indexOf(channel);
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const at = channel.programmes.indexOf(p) + (key === 'ArrowLeft' ? -1 : 1);
      const next = channel.programmes[at];
      if (!next) return;
      prevent();
      focusMinute.current = -1;
      reveal(index, next);
      return;
    }
    const steps: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -6, PageDown: 6 };
    const step = steps[key];
    if (step === undefined) return;
    prevent();
    const target = Math.max(0, Math.min(rows.length - 1, index + step));
    const minute = focusMinute.current >= 0 ? focusMinute.current : Math.max(p.at, scrollX.value / scale);
    focusMinute.current = minute;
    const channelThere = rows[target];
    if (channelThere) reveal(target, programmeAt(channelThere, minute) ?? null, channelThere);
  };

  const reveal = (index: number, programme: GuideProgramme | null, channel?: GuideChannel) => {
    const top = index * row;
    const visibleHeight = body.height - RULER;
    if (top < scrollY.value || top + row > scrollY.value + visibleHeight) {
      list.current?.scrollToOffset({ offset: Math.max(0, top - visibleHeight / 2 + row / 2), animated: false });
    }
    if (programme) {
      const start = programme.at * scale;
      const end = start + programme.span * scale;
      const viewWidth = body.width - rail;
      if (end < scrollX.value + 40 || start > scrollX.value + viewWidth - 40)
        scrollTo(Math.max(0, programme.at - 15), false);
    }
    const id = programme ? cellId(programme.id) : channel ? railId(channel.id) : '';
    focusLater(id);
  };

  const onBody = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w !== body.width || h !== body.height) setBody({ width: w, height: h });
  };

  const followRows = useAnimatedStyle(() => ({ transform: [{ translateY: -scrollY.value }] }));
  const firstRow = Math.max(0, rowBase - 6);
  const lastRow = Math.min(rows.length, rowBase + Math.ceil(body.height / row) + 8);
  const listHeight = Math.max(0, body.height - RULER);
  useEffect(() => { props.onRange(window.from, window.to); }, [window.from, window.to, props.onRange]);
  useEffect(() => {
    const start = firstRow;
    props.onVisible(rows.slice(start, start + Math.ceil(body.height / row) + 14).map(c => c.id));
  }, [rows, firstRow, rowBase, focusRow, body.height, row, props.onVisible]);

  return (
    <View
      style={{ flex: 1, minHeight: 0 }}
      onLayout={onBody}
      accessibilityLabel={msg('ui.programmeGuideUseArrowKeysToMoveAndEnterToWatch')}
    >
      <Ruler look={look} model={model} scale={scale} rail={rail} small={small} scrollX={scrollX} />
      {body.width > 0 ? (
        <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
          <View style={{ width: rail, height: listHeight, overflow: 'hidden', backgroundColor: look.rail, zIndex: 3 }}>
            <Animated.View style={[{ height: rows.length * row }, followRows]}>
              {rows.slice(firstRow, lastRow).map((c, i) => (
                <View
                  key={c.id}
                  style={{
                    position: 'absolute',
                    top: (firstRow + i) * row,
                    left: 0,
                    borderBottomWidth: 1,
                    borderBottomColor: look.hairline,
                  }}
                >
                  <RailCell
                    look={look}
                    channel={c}
                    small={small}
                    width={rail}
                    row={row}
                    selected={c.id === selected.channel}
                    onWatch={props.onWatch}
                  />
                </View>
              ))}
            </Animated.View>
          </View>
          <Animated.ScrollView
            ref={timeline}
            horizontal
            onScroll={onTimeline}
            scrollEventThrottle={16}
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1 }}
          >
            <View style={{ width, height: listHeight }}>
              <TimeLines look={look} model={model} scale={scale} />
              <Animated.FlatList
                ref={list}
                data={rows}
                keyExtractor={c => c.id}
                onScroll={onRows}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                style={{ width, height: listHeight }}
                getItemLayout={(_, index) => ({ length: row, offset: row * index, index })}
                initialScrollIndex={focusRow > 1 ? focusRow - 1 : undefined}
                initialNumToRender={Math.ceil(listHeight / row) + 2}
                windowSize={7}
                extraData={`${column}|${selected.channel}|${selected.programme}|${model.nowMinute}|${scale}`}
                renderItem={({ item }) => (
                  <TimelineRow
                    look={look}
                    channel={item}
                    scale={scale}
                    row={row}
                    small={small}
                    width={width}
                    window={window}
                    visibleWidth={body.width - rail}
                    nowMinute={model.nowMinute}
                    selectedProgramme={item.id === selected.channel ? selected.programme : ''}
                    scrollX={scrollX}
                    onFocus={props.onSelect}
                    onPress={props.onPress}
                    onKey={onKey}
                    onWatch={props.onWatch}
                  />
                )}
              />
              {model.nowMinute >= 0 ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: model.nowMinute * scale - 1,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    zIndex: 2,
                    backgroundColor: look.now,
                    boxShadow: `0px 0px 14px ${look.nowGlow}`,
                  }}
                />
              ) : null}
            </View>
          </Animated.ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** Half-hour and hour lines under every row, and the past dimmed: drawn once for the whole panel. */
function TimeLines({ look, model, scale }: { look: GuideLook; model: GuideModel; scale: number }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: model.minutes * scale }}
    >
      {model.ticks.map(tick => (
        <View
          key={tick.id}
          style={{
            position: 'absolute',
            left: tick.minute * scale,
            top: 0,
            bottom: 0,
            width: 1,
            backgroundColor: tick.hour ? look.hour : look.half,
          }}
        />
      ))}
      {model.nowMinute >= 0 ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: model.nowMinute * scale,
            backgroundColor: look.past,
          }}
        />
      ) : null}
    </View>
  );
}

/** Focus an element by its id once it is drawn (web only: the TV focus engines move focus themselves). */
function focusLater(id: string) {
  if (Platform.OS !== 'web' || !id || typeof document === 'undefined') return;
  let tries = 0;
  const attempt = () => {
    const element = document.getElementById(id);
    if (element) {
      element.focus();
      return;
    }
    tries += 1;
    if (tries < 6) setTimeout(attempt, 40);
  };
  requestAnimationFrame(attempt);
}
