// The live home vocabulary (docs/skin-schema.md, "Live home"): the channel a node is repeated
// over (`ch.*`), the monitor (`tile.*`), the minute clock and lineup sizes, and the collections
// `live.channels` and `live.favorites`. vocabulary.ts spreads these into the document vocabulary.
import type { GuideChannel } from '@vela/core';
import type { LiveView } from './controller';

/** The binding context and environment fields Live TV adds. */
export interface LiveCtx {
  ch?: GuideChannel;
  index: number;
}
export interface LiveEnv {
  live?: LiveView;
}

type LiveAccessor = (c: LiveCtx, e: LiveEnv) => string;

const yes = (value: boolean) => (value ? 'true' : 'false');

function channel(read: (c: GuideChannel, e: LiveEnv) => string): LiveAccessor {
  return (c, e) => (c.ch ? read(c.ch, e) : '');
}

/** The channel on the monitor: the one being dialled while flicking, else the tuned one. */
function tuned(e: LiveEnv): GuideChannel | undefined {
  const live = e.live;
  if (!live?.guide || !live.tunedId) return undefined;
  return live.guide.channels.find(c => c.id === live.tunedId);
}

function onMonitor(read: (c: GuideChannel) => string): LiveAccessor {
  return (_, e) => {
    const c = tuned(e);
    return c ? read(c) : '';
  };
}

const ready = (e: LiveEnv) => e.live?.load === 'ready' && !!e.live.guide;

/** Fields a channel shares with the monitor. */
const SHARED: Record<string, (c: GuideChannel) => string> = {
  logo: c => c.logo,
  now: c => c.now,
  next: c => c.next,
  nowProgress: c => String(c.nowProgress),
  nowRemaining: c => c.nowRemaining,
  nextLabel: c => c.nextLabel,
  nowArt: c => c.nowArt,
  nowEpisode: c => c.nowEpisode,
  nowGenre: c => c.nowGenre,
};

export const LIVE_VOCABULARY: Record<string, LiveAccessor> = {
  ...Object.fromEntries(Object.entries(SHARED).map(([name, read]) => [`ch.${name}`, channel(read)])),
  'ch.id': channel(c => c.id),
  'ch.number': channel(c => c.number),
  'ch.name': channel(c => c.name),
  'ch.group': channel(c => c.group),
  'ch.favorite': channel(c => yes(c.favorite)),
  'ch.tuned': channel((c, e) => yes(c.id === e.live?.tunedId)),

  ...Object.fromEntries(Object.entries(SHARED).map(([name, read]) => [`tile.${name}`, onMonitor(read)])),
  'tile.state': (_, e) => e.live?.tile.state ?? 'off',
  'tile.muted': (_, e) => yes(e.live?.tile.muted ?? true),
  'tile.zapping': (_, e) => e.live?.zapping ?? '',
  'tile.channelId': onMonitor(c => c.id),
  'tile.channelName': onMonitor(c => c.name),
  'tile.channelNumber': onMonitor(c => c.number),

  'env.clock': (_, e) => e.live?.clock ?? '',
  'env.liveReady': (_, e) => yes(ready(e)),
  'env.channelCount': (_, e) => (ready(e) ? String(e.live!.guide!.channels.length) : '0'),
  'env.favoriteCount': (_, e) => (ready(e) ? String(e.live!.guide!.channels.filter(c => c.favorite).length) : '0'),
};

/** The channels a `repeat` over live.channels or live.favorites draws, or null for another collection. */
export function liveCollection<C extends LiveCtx>(over: string, c: C, e: LiveEnv, limit: number): C[] | null {
  if (over !== 'live.channels' && over !== 'live.favorites') return null;
  if (!ready(e)) return [];
  const all = e.live!.guide!.channels;
  const list = over === 'live.favorites' ? all.filter(x => x.favorite) : all;
  return list.slice(0, limit).map((ch, index) => ({ ...c, ch, index }));
}
