import { msg, type GuideChannel, type GuideProgramme } from '@vela/core';
import type { StyleProp, ViewStyle } from 'react-native';
import type { GuideLook } from './look';
export interface RowDrawing {
  channelId: string; originX: number; width: number; height: number; radius: number;
  colours: { cell: string; live: string; liveEdge: string; edge: string; fill: string; accent: string; ink: string; secondary: string };
  font: string; boldFont: string; titleSize: number; detailSize: number;
  cells: { id: string; x: number; width: number; ended: boolean; airing: boolean; elapsed: number; title: string; detail: string; tone: string; label: string }[];
}
export interface GuideRowDrawingProps {
  drawing: RowDrawing;
  selected: string;
  onFocusProgramme?(event: { nativeEvent: { id: string } }): void;
  onPressProgramme?(event: { nativeEvent: { id: string } }): void;
  style?: StyleProp<ViewStyle>;
}

/** Only the visible time window plus a margin crosses the native drawing boundary. */
export function rowDrawing(channel: GuideChannel, programmes: GuideProgramme[], scale: number, height: number,
  window: { from: number; to: number }, now: number, look: GuideLook, small: boolean): RowDrawing {
  const originX = Math.max(0, window.from) * scale;
  return { channelId: channel.id, originX, width: Math.max(1, window.to * scale - originX), height, radius: look.radiusCell,
    colours: { cell: look.cell, live: look.live, liveEdge: look.liveEdge, edge: look.hairline, fill: look.liveFill, accent: look.accent, ink: look.ink, secondary: look.inkSecondary },
    font: String(look.font(600).fontFamily ?? ''), boldFont: String(look.font(680).fontFamily ?? ''), titleSize: (small ? 13 : 14) * 1.3, detailSize: 12 * 1.3,
    cells: programmes.map(p => ({ id: p.id, x: p.at * scale + 2 - originX, width: Math.max(2, p.span * scale - 4), ended: p.ended, airing: p.airing,
      elapsed: p.airing ? Math.max(0, Math.min(p.span * scale - 4, (now - p.at) * scale)) : 0,
      title: p.span >= 10 ? p.name : '', detail: p.span * scale > 110 ? [p.airing ? p.remainingLabel : msg('ui.startEnd', { start: p.startLabel, end: p.endLabel }), p.episode].filter(Boolean).join(' · ') : '',
      tone: p.tone >= 0 && p.span * scale > 24 ? look.tone(p.tone) : '',
      label: msg('ui.programmeStartToEndChannelProgrammeDetails', { programme: p.name, channel: channel.name, start: p.startLabel, end: p.endLabel }) })) };
}
