// Core's search state (the store's search slice: each lane's raw status) as the view documents
// read (env.search): each lane's honest state for the open query, as the Contract foundation
// derived it (behavior.contract descriptiveState and aiState, SearchSurface's aiRunning).
import type { SearchState } from '@vela/core';
import type { DescriptiveLane, DiscoveryLane, SearchView, TitleLane } from './model';

/** The server is still working on a description, and will be asked again. */
const WORKING = ['pending', 'busy', 'indexing'];
/** A discovery job that has not finished; its partial answer shows meanwhile. */
const RUNNING = ['loading', 'queued', 'running', 'partial'];

function titles(lane: SearchState['fast']): TitleLane {
  if (lane.status === 'ready') {
    return { state: 'ready', items: lane.items, channels: lane.liveChannels, programmes: lane.liveProgrammes };
  }
  return { state: lane.status === 'failed' ? 'failed' : 'loading', items: [], channels: [], programmes: [] };
}

/** Not started (`idle`) reads `off` until the lane begins; `unavailable` is off for good. */
function descriptive(lane: SearchState['descriptive']): DescriptiveLane {
  const failed = lane.status === 'failed' || (WORKING.includes(lane.status) && !lane.canRetry);
  const state: DescriptiveLane['state'] = lane.status === 'idle' || lane.status === 'unavailable' ? 'off'
    : failed ? 'failed'
    : lane.status === 'loading' || WORKING.includes(lane.status) ? 'loading'
    : 'ready';
  return { state, items: lane.items, canRetry: state === 'failed' && lane.canRetry };
}

function discovery(lane: SearchState['ai']): DiscoveryLane {
  const state: DiscoveryLane['state'] = lane.status === 'idle' || lane.status === 'unavailable' ? 'off'
    : RUNNING.includes(lane.status) ? 'running'
    : lane.status === 'complete' ? 'complete'
    : 'failed';
  return { state, items: lane.items };
}

/** The view for the open query; none while no query is open. */
export function searchView(state: SearchState): SearchView | undefined {
  if (state.query.trim() === '') return undefined;
  return {
    query: state.query,
    controls: state,
    more: { fast: !!state.fast.nextCursor && !state.fast.loadingMore, descriptive: !!state.descriptive.nextCursor && !state.descriptive.loadingMore },
    titles: titles(state.fast),
    descriptive: descriptive(state.descriptive),
    ai: discovery(state.ai),
  };
}
