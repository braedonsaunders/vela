import type { PlaybackPlan } from '../../wire/v0/types';

/** Resolve broker-issued media references without changing their grant tokens. */
export function mediaPlan(plan: PlaybackPlan, origin: string): PlaybackPlan {
  const url = (value: string) => new URL(value, `${origin.replace(/\/$/, '')}/`).href;
  const track = (value: PlaybackPlan['audioTracks'][number]) => value.url ? { ...value, url: url(value.url) } : value;
  return { ...plan, paths: plan.paths.map(path => ({ ...path, url: url(path.url), qualities: path.qualities.map(quality => ({ ...quality, url: url(quality.url) })) })),
    audioTracks: plan.audioTracks.map(track), subtitleTracks: plan.subtitleTracks.map(track) };
}
