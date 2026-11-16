// The search view state documents read (docs/skin-schema.md, "Search"): for the open query, the
// three lanes of titles and the live hits, each lane with its honest state. The app's search
// generations produce it (env.search); the vocabulary reads it.
import type { liveSearch } from '../../../../../client/src/live/search';
import type { Card } from '../../vocabulary';

type LiveAnswer = ReturnType<typeof liveSearch>;
/** A channel the fast lane matched, with the programme it airs now. */
export type LiveChannelHit = LiveAnswer['liveChannels'][number];
/** A programme the fast lane matched: airing now, or coming up on the guide. */
export type LiveProgrammeHit = LiveAnswer['liveProgrammes'][number];

/** The fast lane: titles by name and live hits. Its lists are empty unless it is `ready`. */
export interface TitleLane {
  state: 'loading' | 'failed' | 'ready';
  items: Card[];
  channels: LiveChannelHit[];
  programmes: LiveProgrammeHit[];
}

/** Descriptive search: `off` when the server does not offer it. A failed lane keeps what it found. */
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
  titles: TitleLane;
  descriptive: DescriptiveLane;
  ai: DiscoveryLane;
}

/** A live hit a node is repeated over: a channel, or a programme. */
export type Hit =
  | { kind: 'channel'; channel: LiveChannelHit }
  | { kind: 'programme'; programme: LiveProgrammeHit };
