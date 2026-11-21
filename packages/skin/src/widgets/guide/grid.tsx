// The EPG grid: one panel that scrolls on both axes, with a time ruler that follows it sideways,
// a channel rail that follows it down, half-hour lines, the past dimmed and a now line. Rows are
// virtualized and each row draws only the programmes near the visible time, so a lineup of
// hundreds over a whole day scrolls as smoothly as a dozen. On the web, arrow keys walk the grid
// (Enter watches what is airing). TV uses one focus anchor so recycling cannot displace focus.
import { NativeGuideGrid } from './native-grid';
import { useLiveContext } from './live';
import { useGuideNavigation } from './focus';
import { bandOffset, deepInGuide, guideEscapeKey, ProgrammeSlots, programmeMinute, gapStep, resolveTimeTarget, rowWindow, prefetchRows, type TimeTarget } from './navigation';
import { BackToTop } from './back-to-top';
import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { FlatList, Platform, Text, TVFocusGuideView, View, type LayoutChangeEvent } from 'react-native';
import Animated, { runOnJS, scrollTo as scrollNative, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { msg, type GuideChannel, type GuideModel, type GuideProgramme } from '@vela/core';
import { cellId, leftFor, minuteWidth, programmeOverlapping, programmeGap, gapId, railWidth, rowHeight, RULER, type Zoom } from './geometry';
import type { GuideLook } from './look';
import { prependOffset } from './timeline';
import { Press } from './parts';
import { RailCell } from './rail';
import { Ruler as GuideRuler } from './ruler';
const Ruler = memo(GuideRuler);
import { TimelineRow } from './timeline-row';
import { currentlyAiring, sameGridContent } from './content';
import { useGuideMinute } from './clock';
import type { LiveController } from './controller';
import { guideRender, startGuideFrames } from './diagnostics';

interface PendingFocus { index: number; minute: number; after?: string; key?: string; takeFocus?: boolean; alignTime?: boolean }

export interface GridHandle {
  /** Enter the grid at the selected channel and visible time. */
  focusGrid(channelId?: string): void;
  leaveGrid(): void;
  selectChannel(channelId: string): boolean;
  /** Bring now into view; false when the shown day is not today. */
  jumpNow(): boolean;
  /** Step the time by hours; the day before or after when that runs off this one. */
  shift(hours: number): -1 | 0 | 1;
  jumpDay(day: number): boolean;
  /** Back to the first channel at now (today), selecting it without taking focus. */
  toTop(): void;
}

export interface GridProps {
  active: boolean;
  liveView: LiveController['view'];
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
const MARGIN = 30;

export const GuideGrid = memo(GuideGridContent, (a, b) =>
  a.liveView === b.liveView && a.look === b.look && a.small === b.small && a.zoom === b.zoom && a.still === b.still
  && a.active === b.active
  && a.selected.channel === b.selected.channel && a.selected.programme === b.selected.programme
  && a.landing.channelId === b.landing.channelId && (!a.landing.channelId || a.landing.minute === b.landing.minute)
  && a.onSelect === b.onSelect && a.onPress === b.onPress && a.onWatch === b.onWatch
  && a.onVisible === b.onVisible && a.onRange === b.onRange && a.handle === b.handle
  && sameGridContent(a.model, a.rows, b.model, b.rows));

function GuideGridContent(props: GridProps) {
  const Surface = useLiveContext()?.GuideSurface;
  return Surface ? <NativeGuideGrid {...props} Surface={Surface} /> : <SharedGuideGrid {...props} />;
}

function SharedGuideGrid(props: GridProps) {
  guideRender('grid');
  const navigation = useGuideNavigation();
  useEffect(() => props.active ? startGuideFrames() : undefined, [props.active]);
  const { look, model, rows, small, zoom, still, selected, landing } = props;
  const scale = minuteWidth(small, zoom);
  const row = rowHeight(small, Platform.isTV);
  const rail = railWidth(small, Platform.isTV);
  const width = model.minutes * scale;
  const [body, setBody] = useState({ width: 0, height: 0 });
  const [canvas, setCanvas] = useState({ width: 0, height: 0 });
  const visibleMinutes = Math.max(30, (body.width - rail) / scale);

  const scrollX = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const position = useRef({ x: 0, y: 0 });
  const targetX = useSharedValue(0);
  const targetY = useSharedValue(0);
  const currentX = () => Platform.isTV ? position.current.x : scrollX.value;
  const currentY = () => Platform.isTV ? position.current.y : scrollY.value;
  const lastPaintRow = useSharedValue(-1);
  const [paintRow, setPaintRow] = useState(() => Math.max(0, rows.findIndex(c => c.id === landing.channelId) - 1));
  const rowSlots = useRef(new ProgrammeSlots()).current;
  const nativeList = useAnimatedRef<Animated.ScrollView>();
  const lastColumn = useSharedValue(-1);
  const lastRowBucket = useSharedValue(-1);
  const [column, setColumn] = useState(-1);
  const focusRow = landing.channelId ? rows.findIndex(c => c.id === landing.channelId) : -1;
  const [rowBase, setRowBase] = useState(() => Math.max(0, focusRow - 1));
  const previousRow = useRef(rowBase);
  const rowDirection = useRef(1);
  if (rowBase !== previousRow.current) {
    rowDirection.current = rowBase > previousRow.current ? 1 : -1;
    previousRow.current = rowBase;
  }
  const timeline = useAnimatedRef<Animated.ScrollView>();
  const list = useRef<FlatList<GuideChannel>>(null);
  const landed = useRef(false);
  const lastScale = useRef(scale);
  const focusMinute = useRef(-1);
  const toolbarMinute = useRef<number | null>(null);
  const waitingTime = useRef<TimeTarget | null>(null);
  const deferredEnter = useRef(false);
  const deferredChannel = useRef<string | undefined>(undefined);
  const pending = useRef<PendingFocus | null>(null);
  const initialFocus = useRef(false);
  const previousStarts = useRef(model.dayStarts ?? {});
  const previousOrigin = useRef(model.startsAt);

  const nativeReady = Platform.isTV && body.width > 0;
  useAnimatedReaction(() => [nativeReady && canvas.width > 0 ? targetX.value : -1, canvas.width], (next, previous) => {
    if (next[0]! >= 0 && (next[0] !== previous?.[0] || next[1] !== previous?.[1])) scrollNative(timeline, next[0]!, 0, false);
  }, [nativeReady, canvas.width]);
  useAnimatedReaction(() => [nativeReady && canvas.height > 0 ? targetY.value : -1, canvas.height], (next, previous) => {
    if (next[0]! >= 0 && (next[0] !== previous?.[0] || next[1] !== previous?.[1])) scrollNative(nativeList, 0, next[0]!, false);
  }, [nativeReady, canvas.height]);

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
        const paint = Math.floor(e.contentOffset.y / row);
        if (paint !== lastPaintRow.value) { lastPaintRow.value = paint; runOnJS(setPaintRow)(paint); }
        const next = Math.floor(e.contentOffset.y / row / 4) * 4;
        if (next !== lastRowBucket.value) { lastRowBucket.value = next; runOnJS(setRowBase)(next); }
      },
    },
    [row],
  );

  const scrollTo = useCallback(
    (minute: number, animated: boolean) => {
      const x = Math.max(0, Math.min(width - (body.width - rail), minute * scale));
      position.current.x = x;
      if (Platform.isTV) targetX.value = animated && !still ? withSpring(x, { damping: 30, stiffness: 240, overshootClamping: true }) : x;
      else timeline.current?.scrollTo({ x, animated: animated && !still });
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
    if (Platform.isTV && focusRow > 1) { position.current.y = (focusRow - 1) * row; targetY.value = position.current.y; scrollY.value = position.current.y; }
    scrollTo(leftFor(landing.minute, visibleMinutes, model.minutes), false);
  }, [body.width, landing.minute, visibleMinutes, model.minutes, scrollTo]);

  // Zooming keeps the time at the panel's left edge where it was.
  useLayoutEffect(() => {
    if (lastScale.current === scale) return;
    const minute = currentX() / lastScale.current;
    lastScale.current = scale;
    scrollTo(minute, false);
  }, [scale, scrollTo, scrollX]);

  useLayoutEffect(() => {
    const next = model.dayStarts ?? {};
    const added = prependOffset(previousStarts.current, next, previousOrigin.current, model.startsAt);
    previousStarts.current = next;
    previousOrigin.current = model.startsAt;
    if (added) {
      if (focusMinute.current >= 0) focusMinute.current += added;
      if (toolbarMinute.current !== null) toolbarMinute.current += added;
      if (pending.current) pending.current.minute += added;
      scrollTo(currentX() / scale + added, false);
    }
  }, [model.dayStarts, model.startsAt, scale, scrollTo, scrollX]);

  const enterGrid = (channelId?: string) => {
    if (!props.active || !body.width || Platform.isTV && (!canvas.width || !canvas.height) || waitingTime.current) {
      deferredEnter.current = true;
      if (channelId) deferredChannel.current = channelId;
      return;
    }
    const desired = channelId || deferredChannel.current || selected.channel;
    deferredChannel.current = undefined;
    const index = Math.max(0, rows.findIndex(c => c.id === desired));
    const channel = rows[index];
    if (!channel) return;
    const left = currentX() / scale;
    const picked = channel.programmes.find(p => p.id === selected.programme);
    const forced = toolbarMinute.current !== null;
    const retained = !forced && picked && picked.at + picked.span > left && picked.at < left + visibleMinutes ? picked : null;
    const minute = toolbarMinute.current ?? (retained ? programmeMinute(retained, focusMinute.current >= 0 ? focusMinute.current : left + visibleMinutes / 3) : left + visibleMinutes / 3);
    toolbarMinute.current = null;
    focusMinute.current = minute;
    reveal(index, retained ?? programmeOverlapping(channel, minute) ?? null, channel, true, !forced);
  };
  const applyTimeTarget = () => {
    if (!waitingTime.current) return true;
    const now = props.liveView().guide?.nowMinute ?? model.nowMinute;
    const target = resolveTimeTarget(waitingTime.current, model.dayStarts ?? {}, now, visibleMinutes, model.minutes);
    if (!target) return false;
    waitingTime.current = null;
    toolbarMinute.current = target.minute;
    scrollTo(target.left, true);
    if (deferredEnter.current) { deferredEnter.current = false; enterGrid(); }
    return true;
  };
  useEffect(() => { applyTimeTarget(); }, [model.dayStarts, model.nowMinute]);
  useImperativeHandle(props.handle, () => ({
    leaveGrid() { pending.current = null; deferredEnter.current = false; deferredChannel.current = undefined; initialFocus.current = true; },
    selectChannel(channelId) {
      const index = rows.findIndex(channel => channel.id === channelId);
      const channel = rows[index];
      if (!channel) return false;
      const minute = focusMinute.current >= 0 ? focusMinute.current : currentX() / scale + visibleMinutes / 3;
      reveal(index, programmeOverlapping(channel, minute) ?? null, channel, false);
      return true;
    },
    focusGrid: enterGrid,
    jumpDay(day) {
      pending.current = null; initialFocus.current = true;
      waitingTime.current = { kind: 'day', day, offset: 0 };
      return applyTimeTarget();
    },
    jumpNow() {
      pending.current = null; initialFocus.current = true;
      waitingTime.current = { kind: 'now', offset: 0 };
      return applyTimeTarget();
    },
    toTop() {
      pending.current = null; deferredEnter.current = false; deferredChannel.current = undefined; initialFocus.current = true;
      const channel = rows[0];
      if (!channel) return;
      position.current.y = 0;
      setRowBase(0);
      if (Platform.isTV) targetY.value = still ? 0 : withSpring(0, { damping: 30, stiffness: 240, overshootClamping: true });
      else { setPaintRow(0); list.current?.scrollToOffset({ offset: 0, animated: !still }); }
      // Entering again lands at now on the first channel; its details show meanwhile.
      waitingTime.current = { kind: 'now', offset: 0 };
      applyTimeTarget();
      const now = props.liveView().guide?.nowMinute ?? model.nowMinute;
      if (now >= 0) focusMinute.current = now;
      props.onSelect(channel, now >= 0 ? programmeOverlapping(channel, now) ?? null : null);
    },
    shift(hours) {
      pending.current = null; deferredEnter.current = false; initialFocus.current = true;
      if (waitingTime.current) { waitingTime.current.offset += hours * 60; applyTimeTarget(); return 0; }
      const target = Math.floor(currentX() / scale / 30) * 30 + hours * 60;
      const left = Math.max(0, Math.min(model.minutes - visibleMinutes, target));
      toolbarMinute.current = left + visibleMinutes / 3;
      scrollTo(left, true);
      return 0;
    },
  }), [model, rows, selected, visibleMinutes, scale, scrollTo, scrollX, props.active, body.width, canvas.width, canvas.height]);

  const leftMinute = Math.max(0, column) * 30;
  const window = useMemo(() => ({ from: leftMinute - MARGIN, to: leftMinute + visibleMinutes + MARGIN, left: leftMinute }), [leftMinute, visibleMinutes]);
  /** Web keyboard: move focus through the grid, bringing the target into view first. */
  const onKey = (channel: GuideChannel, p: GuideProgramme | null, key: string, prevent: () => void) => {
    if (p && key === 'Enter' && currentlyAiring(props.liveView().guide ?? model, channel.id, p.id)) {
      prevent();
      props.onWatch(channel.id);
      return;
    }
    if (pending.current) {
      if (pending.current.key === key) { prevent(); return; }
      pending.current = null;
    }
    const index = rows.findIndex(row => row.id === channel.id);
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (!p) {
        prevent();
        if (channel.listingsUnavailable || !channel.listingsLoaded) return;
        const minute = focusMinute.current >= 0 ? focusMinute.current : landing.minute;
        const next = key === 'ArrowRight' ? channel.programmes.find(p => p.at >= minute)
          : [...channel.programmes].reverse().find(p => p.at + p.span <= minute);
        if (next) {
          focusMinute.current = key === 'ArrowRight' ? next.at : programmeMinute(next, next.at + next.span);
          reveal(index, next);
        } else {
          focusMinute.current = gapStep(minute, key === 'ArrowRight' ? 1 : -1, model.minutes);
          reveal(index, null, channel);
        }
        return;
      }
      const at = channel.programmes.indexOf(p) + (key === 'ArrowLeft' ? -1 : 1);
      const next = channel.programmes[at];
      if (!next) {
        prevent();
        const minute = key === 'ArrowLeft' ? p.at - 0.01 : p.at + p.span;
        if (minute < 0 || minute >= model.minutes) { props.onRange(minute - 180, minute + 180); return; }
        focusMinute.current = minute;
        reveal(index, null, channel);
        const waiting = pending.current as PendingFocus | null;
        if (waiting) { waiting.after = p.id; waiting.key = key; }
        return;
      }
      prevent();
      focusMinute.current = key === 'ArrowRight' ? next.at : programmeMinute(next, next.at + next.span);
      reveal(index, next);
      return;
    }
    if (Platform.OS === 'web' && guideEscapeKey(key)) { prevent(); navigation?.escape(); return; }
    const steps: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -6, PageDown: 6 };
    const step = steps[key];
    if (step === undefined) return;
    prevent();
    // Up from the first channel: a TV goes on to the top bar, a keyboard to the guide's toolbar.
    if (index === 0 && step < 0) { if (Platform.isTV) navigation?.top(); else navigation?.toolbar(); return; }
    const target = Math.max(0, Math.min(rows.length - 1, index + step));
    const minute = focusMinute.current >= 0 ? focusMinute.current : Math.max(p?.at ?? landing.minute, currentX() / scale);
    focusMinute.current = minute;
    const channelThere = rows[target];
    if (channelThere) {
      reveal(target, programmeOverlapping(channelThere, minute) ?? null, channelThere);
      const waiting = pending.current as PendingFocus | null;
      if (waiting) waiting.key = key;
    }
  };

  const reveal = (index: number, programme: GuideProgramme | null, channel?: GuideChannel, takeFocus = true, alignTime = true) => {
    const targetChannel = channel ?? rows[index];
    if (!targetChannel) return;
    const minute = focusMinute.current >= 0 ? focusMinute.current : programme?.at ?? landing.minute;
    const covered = !model.loadedRanges || model.loadedRanges.some(range => range.from <= minute && range.to > minute);
    if ((!targetChannel.listingsLoaded || !covered) && !targetChannel.listingsUnavailable) {
      pending.current = { index, minute, takeFocus, alignTime };
      if (!takeFocus) props.onSelect(targetChannel, null);
      if (!covered) props.onRange(minute - 150, minute + 240);
      const range = rowWindow(index, rows.length, Math.ceil(body.height / row));
      props.onVisible(rows.slice(range.start, range.end).map(c => c.id));
      return;
    }
    if (targetChannel.listingsUnavailable) programme = null;
    pending.current = null;
    const opening = !initialFocus.current;
    initialFocus.current = true;
    const visibleHeight = body.height - RULER;
    const offset = bandOffset(index * row, row, currentY(), visibleHeight, rows.length * row);
    if (offset !== currentY()) {
      position.current.y = offset;
      if (!Platform.isTV) scrollY.value = offset;
      setRowBase(Math.floor(offset / row / 4) * 4);
      if (!Platform.isTV) setPaintRow(Math.floor(offset / row));
      if (Platform.isTV) targetY.value = still ? offset : withSpring(offset, { damping: 30, stiffness: 240, overshootClamping: true });
      else list.current?.scrollToOffset({ offset, animated: !still });
    }
    if (!opening && alignTime) {
      const anchor = programme ? programmeMinute(programme, focusMinute.current) : Math.max(0, minute);
      const next = bandOffset(anchor * scale, 1, currentX(), body.width - rail, width);
      if (next !== currentX()) scrollTo(next / scale, true);
    }
    const gap = !programme && targetChannel.listed && !targetChannel.listingsUnavailable ? programmeGap(targetChannel, minute, model.minutes) : undefined;
    const id = programme ? cellId(programme.id, targetChannel.id) : gap ? gapId(targetChannel.id, gap.at) : `guide-empty-${targetChannel.id}`;
    if (Platform.isTV || !takeFocus || !programme) props.onSelect(targetChannel, programme);
    if (takeFocus) navigation?.request(Platform.isTV ? 'guide-grid-focus' : id);
  };

  useEffect(() => {
    if (!props.active || !body.width || Platform.isTV && (!canvas.width || !canvas.height)) return;
    if (deferredEnter.current && !waitingTime.current) { deferredEnter.current = false; enterGrid(); return; }
    if (pending.current) {
      const { index, minute, after, takeFocus, alignTime } = pending.current;
      const channel = rows[index];
      if (!channel?.listingsUnavailable && model.loadedRanges && !model.loadedRanges.some(range => range.from <= minute && range.to > minute)) return;
      if (channel?.listingsLoaded || channel?.listingsUnavailable) {
        focusMinute.current = minute;
        const programme = programmeOverlapping(channel, minute) ?? null;
        if (after && programme?.id === after) { pending.current = null; return; }
        reveal(index, programme, channel, takeFocus !== false, alignTime !== false);
      }
      return;
    }
    if (initialFocus.current) {
      if (!navigation?.inGrid()) return;
      const index = rows.findIndex(c => c.id === selected.channel);
      const channel = rows[index];
      if (selected.programme && channel?.listingsUnavailable) { reveal(index, null, channel); return; }
      if (!selected.programme && channel?.listingsLoaded) {
        const programme = programmeOverlapping(channel, focusMinute.current);
        if (programme) reveal(index, programme, channel);
      }
      return;
    }
    const index = Math.max(0, rows.findIndex(c => c.id === landing.channelId));
    const channel = rows[index];
    if (!channel || !channel.listingsLoaded && !channel.listingsUnavailable) {
      pending.current = { index, minute: landing.minute };
      const range = rowWindow(index, rows.length, Math.ceil(body.height / row));
      props.onVisible(rows.slice(range.start, range.end).map(c => c.id));
      return;
    }
    focusMinute.current = landing.minute;
    reveal(index, programmeOverlapping(channel, landing.minute) ?? null, channel);
  }, [rows, body.width, canvas.width, canvas.height, props.active]);

  const events = useRef({ onKey, select: props.onSelect });
  events.current = { onKey, select: props.onSelect };
  const keyHandler = useCallback((channel: GuideChannel, programme: GuideProgramme | null, key: string, prevent: () => void) => events.current.onKey(channel, programme, key, prevent), []);
  const focusHandler = useCallback((channel: GuideChannel, programme: GuideProgramme | null) => {
    if (!pending.current) {
      if (programme) focusMinute.current = programmeMinute(programme, focusMinute.current);
      events.current.select(channel, programme);
    }
  }, []);
  const onBody = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w !== body.width || h !== body.height) setBody({ width: w, height: h });
  };

  const followRows = useAnimatedStyle(() => ({ transform: [{ translateY: -scrollY.value }] }));
  const { start: firstRow, end: lastRow } = rowWindow(rowBase, rows.length, Math.ceil(body.height / row));
  const listHeight = Math.max(0, body.height - RULER);
  useEffect(() => { props.onRange(window.from - 120, window.to + 120); }, [window.from, window.to, props.onRange]);
  useEffect(() => {
    const range = prefetchRows(rowBase, rows.length, Math.ceil(body.height / row), rowDirection.current);
    if (!pending.current) props.onVisible(rows.slice(range.start, range.end).map(c => c.id));
  }, [rows, firstRow, rowBase, focusRow, body.height, row, props.onVisible]);

  const paint = rowWindow(paintRow, rows.length, Math.ceil(listHeight / row), 2);
  const painted = rows.slice(paint.start, paint.end);
  const nativeRows = Platform.isTV ? rowSlots.ordered(painted, channel => channel.id) : [];
  const railRows = Platform.isTV ? nativeRows.map(({ key, index, item }) => ({ key, index: paint.start + index, channel: item }))
    : rows.slice(firstRow, lastRow).map((channel, index) => ({ key: channel.id, index: firstRow + index, channel }));
  const renderRow = (item: GuideChannel, index: number) => <TimelineRow
    look={look} channel={item} scale={scale} row={row} small={small} width={width}
    window={window} visibleWidth={body.width - rail} visibleHeight={listHeight} rowTop={index * row} scrollY={scrollY} nowMinute={model.nowMinute}
    selectedChannel={item.id === selected.channel}
    selectedMinute={item.id === selected.channel ? focusMinute.current : -1}
    selectedProgramme={item.id === selected.channel ? selected.programme : ''}
    scrollX={scrollX} onFocus={focusHandler} onPress={props.onPress} onKey={keyHandler} onWatch={props.onWatch}
  />;
  return (
    <View
      style={{ flex: 1, minHeight: 0 }}
      onLayout={onBody}
      accessibilityLabel={msg('ui.programmeGuideUseArrowKeysToMoveAndEnterToWatch')}
    >
      <Ruler viewportWidth={Math.max(0, body.width - rail)} look={look} model={model} scale={scale} rail={rail} small={small} scrollX={scrollX} window={window} />
      {body.width > 0 ? (
        <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
          <View style={{ width: rail, height: listHeight, overflow: 'hidden', backgroundColor: look.rail, zIndex: 3 }}>
            <Animated.View style={[{ height: rows.length * row }, followRows]}>
              {railRows.map(({ key, index, channel: c }) => (
                <View
                  key={key}
                  style={{
                    position: 'absolute',
                    top: index * row,
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
            scrollEnabled={!Platform.isTV}
            // iOS scrolls to the top on a status-bar tap only when one scroller on screen asks to:
            // the channel list, not the sideways timeline.
            scrollsToTop={false}
            onScroll={onTimeline}
            onContentSizeChange={Platform.isTV ? width => setCanvas(old => old.width === width ? old : { ...old, width }) : undefined}
            scrollEventThrottle={16}
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1 }}
          >
            <View style={{ width, height: listHeight }}>
              <TimeLines look={look} model={model} scale={scale} window={window} />
              {Platform.isTV ? <Animated.ScrollView
                ref={nativeList} onScroll={onRows} scrollEventThrottle={16} scrollEnabled={false}
                onContentSizeChange={(_width, height) => setCanvas(old => old.height === height ? old : { ...old, height })}
                contentOffset={{ x: 0, y: 0 }}
                showsVerticalScrollIndicator={false} style={{ width, height: listHeight }}
              >
                <View style={{ width, height: rows.length * row }}>
                  {nativeRows.map(({ key, index, item: channel }) => <View key={key} style={{ position: 'absolute', top: (paint.start + index) * row, left: 0 }}>{renderRow(channel, paint.start + index)}</View>)}
                </View>
              </Animated.ScrollView> : (
              <Animated.FlatList
                ref={list}
                data={rows}
                scrollEnabled={!Platform.isTV}
                keyExtractor={c => c.id}
                onScroll={onRows}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                style={{ width, height: listHeight }}
                getItemLayout={(_, index) => ({ length: row, offset: row * index, index })}
                initialScrollIndex={focusRow > 1 ? focusRow - 1 : undefined}
                initialNumToRender={Math.ceil(listHeight / row) + 2}
                windowSize={3}
                maxToRenderPerBatch={8}
                updateCellsBatchingPeriod={16}
                extraData={`${column}|${selected.channel}|${selected.programme}|${model.nowMinute}|${scale}`}
                renderItem={({ item, index }) => renderRow(item, index)}
              />
              )}
              <NowLine look={look} model={model} scale={scale} />
            </View>
          </Animated.ScrollView>
        </View>
      ) : null}
      {!Platform.isTV && body.width > 0 && deepInGuide(rowBase * row, listHeight)
        ? <BackToTop look={look} onPress={() => {
          navigation?.rewind();
          // The button leaves with the depth: keyboard focus goes on to the first channel at now.
          const first = rows[0]?.id;
          if (Platform.OS === 'web' && first) requestAnimationFrame(() => enterGrid(first));
        }} /> : null}
      {/* The native anchor lives outside the scrollers: tvOS must not auto-scroll a recycled
          cell into view. Logical programme focus and its ring move only after data is ready. */}
      {Platform.isTV && body.width > 0 ? <TVFocusGuideView trapFocusUp trapFocusDown trapFocusLeft trapFocusRight
        style={{ position: 'absolute', left: rail, top: RULER, width: 2, height: 2 }}><Press
        containedFocus
        nativeID="guide-grid-focus"
        label={(() => { const channel = rows.find(c => c.id === selected.channel); const programme = channel?.programmes.find(p => p.id === selected.programme); return `${channel?.name ?? ''}. ${programme?.name ?? ''}. ${programme?.startLabel ?? ''}`; })()}
        onKey={(key, prevent) => {
          const channel = rows.find(c => c.id === selected.channel);
          const programme = channel?.programmes.find(p => p.id === selected.programme) ?? null;
          if (channel) onKey(channel, programme, key, prevent);
        }}
        onPress={() => {
          const channel = rows.find(c => c.id === selected.channel);
          const programme = channel?.programmes.find(p => p.id === selected.programme);
          if (channel && programme) props.onPress(channel, programme);
          else if (channel) props.onWatch(channel.id);
        }}
        style={() => ({ flex: 1, backgroundColor: 'transparent' })}
      ><View /></Press></TVFocusGuideView> : null}
    </View>
  );
}

/** Half-hour and hour lines under every row, and the past dimmed: drawn once for the whole panel. */
const TimeLines = memo(function TimeLines({ look, model, scale, window }: { look: GuideLook; model: GuideModel; scale: number; window: { from: number; to: number } }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: model.minutes * scale }}
    >
      {model.ticks.filter(tick => tick.minute + 30 > window.from && tick.minute < window.to).map(tick => (
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

    </View>
  );
});

const NowLine = memo(function NowLine({ look, model, scale }: { look: GuideLook; model: GuideModel; scale: number }) {
  const minute = useGuideMinute(model.nowMinute);
  const counts = guideRender('marker');
  if (minute < 0) return null;
  return <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: minute * scale, backgroundColor: look.past }}>
    <View style={{ position: 'absolute', right: -0.5, top: 0, bottom: 0, width: 1, backgroundColor: look.now, boxShadow: `0px 0px 14px ${look.nowGlow}` }} />
    {counts ? <Text style={{ position: 'absolute', right: 8, top: 4, color: '#ffff00', backgroundColor: '#000000', fontSize: 14 }}>{counts}</Text> : null}
  </View>;
}, (a, b) => a.look === b.look && a.scale === b.scale && Math.floor(a.model.nowMinute) === Math.floor(b.model.nowMinute));
