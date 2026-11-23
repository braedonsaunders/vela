// Core's search state (the store's search slice: each lane's raw status) as the view documents
// read (env.search): the open query's one list (core's searchList) and how the description side
// contributed to it, plus the live hits the fast lane found and the discovery lane's state.
import { searchList, type SearchState } from '@vela/core';
import type { DescriptiveLane, DiscoveryLane, SearchView, TitleLane } from './model';

/** A discovery job that has not finished; its partial answer shows meanwhile. */
const RUNNING = ['loading', 'queued', 'running', 'partial'];

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
  const list = searchList(state);
  const live = list.state === 'ready' && state.fast.status === 'ready';
  const titles: TitleLane = {
    state: list.state,
    items: list.items,
    channels: live ? state.fast.liveChannels : [],
    programmes: live ? state.fast.liveProgrammes : [],
  };
  // Description matches are part of the one list: the lane itself lists nothing on its own.
  const descriptive: DescriptiveLane = { state: list.description, items: [], canRetry: list.canRetry };
  return {
    query: state.query,
    controls: state,
    more: { fast: !!list.more, descriptive: false },
    titles,
    byDescription: list.byDescription,
    descriptive,
    ai: discovery(state.ai),
  };
}
