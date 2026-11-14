import type { PlaybackPlan } from '../../wire/v0/types';

/** Resolve broker-issued media references without changing their grant tokens. */
export function mediaPlan(plan: PlaybackPlan, origin: string): PlaybackPlan {
  const url = (value: string) => {
    const parsed = new URL(value, `${origin.replace(/\/$/, '')}/`);
    if (parsed.origin !== origin || !parsed.pathname.startsWith('/sessions/media/') || parsed.username || parsed.password) throw new Error('Media URL outside bound session broker');
    return parsed.href;
  };
  const track = (value: PlaybackPlan['audioTracks'][number]) => value.url ? { ...value, url: url(value.url) } : value;
  return { ...plan, paths: plan.paths.map(path => ({ ...path, url: url(path.url), qualities: path.qualities.map(quality => ({ ...quality, url: url(quality.url) })) })),
    audioTracks: plan.audioTracks.map(track), subtitleTracks: plan.subtitleTracks.map(track) };
}
