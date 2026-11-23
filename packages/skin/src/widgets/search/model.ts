// The search view state documents read (docs/skin-schema.md): for the open query, its one list
// of titles (matched by name, or by description as a fallback) and the live hits, with how the
// description search contributed. The app's search
// generations produce it (env.search); the vocabulary reads it.
import type { LiveChannelResult, LiveProgrammeResult } from '@vela/core';
import type { Card } from '../../vocabulary';

/** A channel the fast lane matched, with the programme it airs now. */
export type LiveChannelHit = LiveChannelResult;
/** A programme the fast lane matched: airing now, or coming up on the guide. */
export type LiveProgrammeHit = LiveProgrammeResult;

/** The one list: titles by name, or by description as a fallback, and the fast lane's live hits.
 * Its lists are empty unless it is `ready`; it stays `loading` until the lane it shows has answered. */
export interface TitleLane {
  state: 'loading' | 'failed' | 'ready';
  items: Card[];
  channels: LiveChannelHit[];
  programmes: LiveProgrammeHit[];
}

/** The description search as far as the list depends on it: `off` when it plays no part. Its
 * matches are in the one list (`titles`); `items` stays empty. */
export interface DescriptiveLane {
  state: 'off' | 'loading' | 'failed' | 'ready';
  items: Card[];
  /** The server allows asking again now (after its backoff). */
  canRetry: boolean;
}

/** Discovery (AI search): `running` shows its partial answer while the job continues. */
export interface DiscoveryLane {
  state: 'off' | 'running' | 'failed' | 'complete';
  items: Card[];
}

export interface SearchView {
  query: string;
  controls?: Pick<import('@vela/core').SearchState, 'sort' | 'direction' | 'kind' | 'searchSorts' | 'searchKinds' | 'searchLibraries' | 'library'>;
  more?: { fast: boolean; descriptive: boolean };
  titles: TitleLane;
  /** The list matches a description (or, when empty, the query asked for one). */
  byDescription?: boolean;
  descriptive: DescriptiveLane;
  ai: DiscoveryLane;
}

/** A live hit a node is repeated over: a channel, or a programme. */
export type Hit =
  | { kind: 'channel'; channel: LiveChannelHit }
  | { kind: 'programme'; programme: LiveProgrammeHit };
