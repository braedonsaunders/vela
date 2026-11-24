// Live events and multiview. The LiveEvent shapes are a plugin's feed as Ether reads it (the mock's
// simulation produces them); Vela itself reads live events only as the view-model records of plugin
// screens (screen.ts; Ether design section 5.4). The session's liveEvent reference and multiview
// stay on the wire.
import type { Device, ID, Mutation, Timestamp } from './types';

export type LiveEventState = 'pre' | 'in' | 'post' | 'delayed' | 'postponed' | 'canceled';
export interface LiveLeague { id: ID; name: string; abbr?: string; logo?: string }
export interface LiveEventStatus {
  state: LiveEventState;
  /** Display text, e.g. "Q4 · 2:14", "71'", "Final". */
  detail: string;
  period?: number;
  clock?: string;
  /** The plugin's own judgement that the event is close (drives close-game alerts). */
  close?: boolean;
}
/** One side of an event. `score` is a string so sets, runs and wickets read as written. */
export interface LiveCompetitor {
  id: ID; name: string; short?: string; abbr?: string; logo?: string;
  /** `#rrggbb` or `rrggbb`. */ color?: string; altColor?: string;
  score?: string; record?: string; rank?: number; home?: boolean; winner?: boolean;
  /** The entity this competitor is, for favourites (LiveEntity.id). */ entityId?: ID;
}
/** A row of an N-competitor event (motorsport, golf). `pos` repeats for a tie. `detail` is the
 * row's headline value (a score to par, a gap, points); `secondary` its quieter context ("Thru 14",
 * "R3 -2", "+1 lap"). */
export interface LiveRankingRow { pos: number; name: string; abbr?: string; detail?: string; secondary?: string; entityId?: ID }
/** value 0..1: the chance `competitorId` (or the event's first competitor) wins. */
export interface LiveProbability { label: string; value: number; competitorId?: ID }
export interface LiveBroadcast { name: string; kind: 'tv' | 'stream' | 'radio'; region?: string }
/** Where the viewer can watch an event, cheapest match first (spec A5). */
export interface WatchTarget {
  kind: 'channel' | 'addon' | 'plugin';
  /** Live TV channel to tune, for `channel` (and channel-backed add-ons). */
  channelId?: ID;
  name: string; number?: string; logo?: string;
  /** On air now. */ live: boolean;
  /** 0..1. */ confidence: number;
  /** false: Ether knows the channel cannot play now (its source is failing). Shown as
   * "unavailable right now", never as a button. Absent means available. */
  available?: boolean;
  /** The event's programme on this channel when it is archived (catchUp) or on air with its start archived
   * (startOver): "Watch from start" (features.liveCatchUp). */
  programme?: { id: ID; start: Timestamp; end: Timestamp; catchUp?: boolean; startOver?: boolean };
}
export interface LiveEvent {
  /** Namespaced by Ether (`pluginID:feedID:id`); opaque to clients. */ id: ID;
  feed: ID;
  /** Free text: "football", "f1". */ category: string;
  league: LiveLeague;
  title?: string;
  start: Timestamp;
  status: LiveEventStatus;
  /** Two for most sports; N-competitor events use `ranking` instead. */
  competitors: LiveCompetitor[];
  ranking?: LiveRankingRow[];
  /** Short label/value pairs shown under the score: {"Down": "3rd & 6"}. */
  situation?: Record<string, string>;
  probability?: LiveProbability;
  venue?: string | { name: string; city?: string };
  broadcasts?: LiveBroadcast[];
  matchHints?: { terms: string[]; callsigns: string[] };
  /** Set by Ether for spoiler-free viewers: scores, probability and plays are withheld until revealed. */
  spoiler?: boolean;
  updatedAt: Timestamp;
  /** Resolved per viewer by Ether in screens and details. */
  watch?: WatchTarget[];
}
/** Generic table (box score, linescore, standings). Cells are display strings. */
export interface LiveTable { title: string; columns: string[]; rows: string[][] }
export interface LivePlay { clock?: string; period?: number; text: string; emphasis: 'score' | 'key' | 'normal'; competitorId?: ID;
  /** Optional, plugin-supplied: when the play happened, and the score after it by competitor id. With them a
   * delayed (timeshifted) viewer sees the score as of the picture. */
  at?: Timestamp; score?: Record<ID, string> }
/** `t` orders the series: elapsed fraction/seconds (number) or a timestamp (string). */
export interface LiveProbabilityPoint { t: number | string; value: number }
export interface LiveEventDetail extends LiveEvent {
  tables: LiveTable[];
  plays: LivePlay[];
  probabilitySeries: LiveProbabilityPoint[];
  links: { label: string; url: string }[];
}
/** The kinds of alert Ether raises for a viewer's favourites (the stream's AlertFrame.kind). */
export type LiveAlertKind = 'started' | 'close' | 'final';

/** The event on air on a playing live channel (session snapshot and the session stream's `liveEvent`). */
export interface LiveEventRef { id: ID; feed: ID }
/** Data of the session stream's `event: liveEvent`, sent when the programme on air changes. */
export interface SessionLiveEvent { liveEvent: LiveEventRef | null }

// Multiview (spec B)

export interface MultiviewRequest extends Mutation { device: Device }
export interface MultiviewGroup { groupId: ID; maxTiles: number }
/** On a live-channel PlaybackRequest. `maxHeight`: the tile's on-screen height in device pixels,
 * rounded up to 480/720/1080/2160; Ether caps the tile's stream at it (absent: the group-size rule).
 * A tile that grows (full screen, the big tile) asks again with the larger height. */
export interface MultiviewTile { groupId: ID; tile: number; maxHeight?: number }
/** ProtocolError.details of `provider_connection_cap` (HTTP 409, class capacity). */
export interface ProviderCapDetails { provider: string; max: number; inUse: number }
