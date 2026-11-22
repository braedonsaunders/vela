// Live events, plugin screens and multiview (Ether Sports, 0.3.19). Generic on the wire: nothing
// here says which sport, league or data provider; a plugin's feed fills these shapes and Ether
// resolves screens, favourites, spoilers and where to watch for the viewer.
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
export interface LivePlay { clock?: string; period?: number; text: string; emphasis: 'score' | 'key' | 'normal'; competitorId?: ID }
/** `t` orders the series: elapsed fraction/seconds (number) or a timestamp (string). */
export interface LiveProbabilityPoint { t: number | string; value: number }
export interface LiveEventDetail extends LiveEvent {
  tables: LiveTable[];
  plays: LivePlay[];
  probabilitySeries: LiveProbabilityPoint[];
  links: { label: string; url: string }[];
}
export interface LiveEventsResponse { events: LiveEvent[] }

/** A favouritable entity (a team). `key` is the favourites key (`pluginID:feed:kind:id`). */
export interface LiveEntity {
  id: ID; kind: string; name: string; abbr?: string; logo?: string; league?: string; color?: string;
  key?: string; favorite?: boolean;
}
export interface LiveEntitiesResponse { entities: LiveEntity[] }
/** The viewer's live-event preferences (GET, PUT /live/preferences). Spoiler-free withholds scores,
 * probability and plays until an event is revealed. */
export interface LivePreferences { spoilerFree: boolean }

/** `/live/stream` server events. `update` carries only changed events; `heartbeat` every 25 s. */
export interface LiveStreamUpdate { events: LiveEvent[] }
export type LiveAlertKind = 'started' | 'close' | 'final';
/** `/live/stream?alerts=1` `alert` events, for the viewer's favourites. */
export interface LiveAlert { id: ID; kind: LiveAlertKind; eventId: ID; entityKey: string; title: string; body: string; at: Timestamp }

/** The event on air on a playing live channel (session snapshot and the session stream's `liveEvent`). */
export interface LiveEventRef { id: ID; feed: ID }
/** Data of the session stream's `event: liveEvent`, sent when the programme on air changes. */
export interface SessionLiveEvent { liveEvent: LiveEventRef | null }

// Plugin screens

/** A top-level section from bootstrap `navigation`, listed after Live TV. */
export interface NavigationEntry { kind: 'screen'; id: ID; title: string; icon?: string }

export interface ScreenEventsQuery {
  state?: LiveEventState[]; league?: ID; favorites?: boolean; window?: 'today' | 'week' | 'recent';
}
interface SectionBase { id: ID; title?: string }
/** The featured event: a favourite's live game, else the biggest live game. `also`: the side list. */
export interface HeroSection extends SectionBase { type: 'hero'; event: LiveEvent | null; also?: LiveEvent[] }
export interface EventsSection extends SectionBase { type: 'events'; query?: ScreenEventsQuery; events: LiveEvent[] }
export interface TableSection extends SectionBase { type: 'table'; feed: ID; league?: ID; tables: LiveTable[] }
/** A date-paged timeline; `date` is the shown day (YYYY-MM-DD), `previous`/`next` page it. */
export interface ScheduleSection extends SectionBase {
  type: 'schedule'; date: string; previous?: string; next?: string;
  days?: { date: string; label: string; count?: number }[];
  events: LiveEvent[];
}
export interface LeaguesSection extends SectionBase { type: 'leagues'; leagues: LiveLeague[]; selected?: ID }
/** The favourite picker: the viewer's favourites first, then suggestions. */
export interface EntitiesSection extends SectionBase { type: 'entities'; feed: ID; entityKind: string; entities: LiveEntity[] }
export type ScreenSection = HeroSection | EventsSection | TableSection | ScheduleSection | LeaguesSection | EntitiesSection;
/** GET /screens/:id?league=&date= */
export interface Screen { id: ID; title: string; icon?: string; league?: ID; date?: string; sections: ScreenSection[] }

// Multiview (spec B)

export interface MultiviewRequest extends Mutation { device: Device }
export interface MultiviewGroup { groupId: ID; maxTiles: number }
/** On a live-channel PlaybackRequest. `maxHeight`: the tile's on-screen height in device pixels,
 * rounded up to 480/720/1080/2160; Ether caps the tile's stream at it (absent: the group-size rule).
 * A tile that grows (full screen, the big tile) asks again with the larger height. */
export interface MultiviewTile { groupId: ID; tile: number; maxHeight?: number }
/** ProtocolError.details of `provider_connection_cap` (HTTP 409, class capacity). */
export interface ProviderCapDetails { provider: string; max: number; inUse: number }
