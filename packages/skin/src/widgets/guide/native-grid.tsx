import { useGuideMinute } from './clock';
import { nativeGuideChannels } from './native-data';
import { msg } from '@vela/core';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useGuideNavigation } from './focus';
import type { GridProps } from './grid';
import { rowDrawing, type RowDrawing } from './drawing';
import { minuteWidth, railWidth, rowHeight, programmeOverlapping } from './geometry';
import { rowWindow, resolveTimeTarget, type TimeTarget } from './navigation';
import { startGuideFrames } from './diagnostics';

export interface NativeGuideProps {
  data: { ticks: { minute: number; label: string; hour: boolean }[]; dayLabel: string; nowLabel: string; chrome: { rail: string; ink: string; secondary: string; accent: string; now: string }; emptyLabel: string; channels: { id: string; name: string; number: string; logo: string; logoKey: string; cells: { id: string; at: number; span: number }[] }[];
    drawings: RowDrawing[]; minutes: number; scale: number; row: number; rail: number; now: number; startsAt: number };
  command: { serial: number; channel: string; minute: number; focus: boolean };
  active: boolean;
  onWindow(event: { nativeEvent: { first: number; last: number; from: number; to: number } }): void;
  onProgramme(event: { nativeEvent: { channel: string; minute: number; press: boolean } }): void;
  onExit(event: { nativeEvent: { toolbar: boolean } }): void;
  style?: StyleProp<ViewStyle>;
}

/** Native scrolling reports a bounded viewport; shared TS still owns data, tuning and selection. */
export function NativeGuideGrid(props: GridProps & { Surface: ComponentType<NativeGuideProps> }) {
  const { model, rows, look, small, zoom, Surface } = props;
  const navigation = useGuideNavigation();
  const now = useGuideMinute(model.nowMinute);
  const scale = minuteWidth(small, zoom), row = rowHeight(small, true), rail = railWidth(small, true);
  const [viewport, setViewport] = useState({ first: Math.max(0, rows.findIndex(c => c.id === props.landing.channelId) - 1), last: 12, from: Math.max(0, props.landing.minute - 60), to: props.landing.minute + 240 });
  const [command, setCommand] = useState({ serial: 0, channel: props.landing.channelId || props.selected.channel, minute: props.landing.minute, focus: false });
  const latest = useRef(props); latest.current = props;
  const time = useRef(props.landing.minute);
  const origin = useRef(model.startsAt);
  useEffect(() => {
    if (origin.current !== undefined && model.startsAt !== undefined) time.current += (origin.current - model.startsAt) / 60000;
    origin.current = model.startsAt;
  }, [model.startsAt]);
  const waiting = useRef<TimeTarget | null>(null);
  const enter = (channel?: string, minute?: number, focus = true) => setCommand(old => ({ serial: old.serial + 1, channel: channel || latest.current.selected.channel, minute: minute ?? time.current, focus }));
  useEffect(() => {
    navigation?.register('guide-native-grid', { target: { requestTVFocus: () => enter() }, nativeGrid: true });
    return () => navigation?.register('guide-native-grid', null);
  }, [navigation]);
  useEffect(() => props.active ? startGuideFrames() : undefined, [props.active]);
  const applyTime = () => {
    if (!waiting.current) return true;
    const target = resolveTimeTarget(waiting.current, model.dayStarts ?? {}, props.liveView().guide?.nowMinute ?? model.nowMinute, Math.max(30, viewport.to - viewport.from), model.minutes);
    if (!target) return false;
    waiting.current = null; time.current = target.minute; enter(undefined, target.minute, false); return true;
  };
  useEffect(() => { applyTime(); }, [model.dayStarts, model.nowMinute]);
  useImperativeHandle(props.handle, () => ({
    focusGrid: channel => enter(channel), leaveGrid() {},
    selectChannel(channel) { if (!rows.some(c => c.id === channel)) return false; enter(channel); return true; },
    jumpNow() { waiting.current = { kind: 'now', offset: 0 }; return applyTime(); },
    shift(hours) { if (waiting.current) { waiting.current.offset += hours * 60; applyTime(); } else { time.current = Math.max(0, Math.min(model.minutes - 1, viewport.from + hours * 60 + 60)); enter(undefined, time.current, false); } return 0; },
    jumpDay(day) { waiting.current = { kind: 'day', day, offset: 0 }; return applyTime(); },
  }));
  const data = useMemo(() => {
    const range = rowWindow(viewport.first, rows.length, Math.max(1, viewport.last - viewport.first), 12);
    const window = { from: Math.max(0, viewport.from - 60), to: Math.min(model.minutes, viewport.to + 60) };
    return { ticks: model.ticks, dayLabel: model.dayLabel, nowLabel: props.liveView().guide?.nowLabel ?? model.nowLabel, chrome: { rail: look.rail, ink: look.ink, secondary: look.inkQuiet, accent: look.accent, now: look.now }, emptyLabel: msg('live.noListings'), channels: nativeGuideChannels(rows, window.from, window.to),
      drawings: rows.slice(range.start, range.end).map(c => rowDrawing(c, c.programmes.filter(p => p.at + p.span > window.from && p.at < window.to), scale, row, window, now, look, small)),
      minutes: model.minutes, scale, row, rail, now, startsAt: model.startsAt ?? Date.now() - model.nowMinute * 60000 };
  }, [rows, viewport, model.minutes, model.ticks, model.dayLabel, model.nowLabel, now, model.startsAt, scale, row, rail, look, small]);
  const onWindow = useCallback(({ nativeEvent: v }: Parameters<NativeGuideProps['onWindow']>[0]) => {
    setViewport(old => old.first === v.first && old.last === v.last && old.from === v.from && old.to === v.to ? old : v);
    const p = latest.current;
    const range = rowWindow(v.first, p.rows.length, v.last - v.first);
    p.onVisible(p.rows.slice(range.start, range.end).map(c => c.id)); p.onRange(v.from - 120, v.to + 120);
  }, []);
  return <Surface style={{ flex: 1, minHeight: 0 }} data={data} command={command} active={props.active} onWindow={onWindow}
    onProgramme={({ nativeEvent: e }) => {
      time.current = e.minute;
      const channel = rows.find(c => c.id === e.channel); if (!channel) return;
      const programme = programmeOverlapping(channel, e.minute) ?? null;
      navigation?.focused('guide-native-grid'); props.onSelect(channel, programme);
      if (e.press) { if (programme) props.onPress(channel, programme); else props.onWatch(channel.id); }
    }} onExit={({ nativeEvent: e }) => { navigation?.blurred('guide-native-grid'); if (e.toolbar) navigation?.toolbar(); }} />;
}
