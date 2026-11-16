import type { PlaybackPlan } from '../../wire/v0/types';

/** Resolve broker-issued media references without changing their grant tokens. */
export function mediaPlan(plan: PlaybackPlan, origin: string): PlaybackPlan {
  const url = (value: string) => {
    const parsed = new URL(value, `${origin.replace(/\/$/, '')}/`);
    if (parsed.origin !== origin || !parsed.pathname.startsWith('/sessions/media/') || parsed.username || parsed.password) throw new Error('Media URL outside bound session broker');
    return parsed.href;
  };
  const track = (value: PlaybackPlan['audioTracks'][number]) => value.url ? { ...value, url: url(value.url) } : value;
  return { ...plan, paths: plan.paths.map(path => {
    const normalized = {
      ...(path.audioRenditions ? { audioRenditions: path.audioRenditions.map(audio => ({ ...audio, url: url(audio.url) })) } : {}),
      qualities: path.qualities.map(quality => ({ ...quality, url: url(quality.url) })),
    };
    return path.readiness === 'on-demand' ? { ...path, ...normalized } : { ...path, ...normalized, url: url(path.url) };
  }),
    audioTracks: plan.audioTracks.map(track), subtitleTracks: plan.subtitleTracks.map(track) };
}

/** A native adapter's plan: every media URL stays inside the server's media scope and
 * carries no credential, which the player host attaches only from its private authorization. */
export function scopedPlan(plan: PlaybackPlan, scope: { origin: string; pathPrefix: string }): PlaybackPlan {
  const prefix = scope.pathPrefix.endsWith('/') ? scope.pathPrefix : `${scope.pathPrefix}/`;
  const check = (value: string) => {
    const parsed = new URL(value);
    if (parsed.origin !== scope.origin || parsed.username || parsed.password || parsed.hash || !(parsed.pathname + '/').startsWith(prefix) ||
      [...parsed.searchParams.keys()].some(key => /^(api_key|apikey|access_token|x-plex-token|x-emby-token|authorization)$/i.test(key)))
      throw new Error('Media URL outside the selected server');
    return value;
  };
  for (const path of plan.paths) {
    if (path.readiness !== 'on-demand') check(path.url);
    for (const quality of path.qualities) check(quality.url);
    for (const audio of path.audioRenditions ?? []) check(audio.url);
  }
  for (const track of [...plan.audioTracks, ...plan.subtitleTracks]) {
    if (track.url) check(track.url);
    if (track.delivery?.kind === 'external') check(track.delivery.url);
  }
  return plan;
}
