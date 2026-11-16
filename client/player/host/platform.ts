import type { HostContext, NativeAudioTrack } from './state';
export function saveVolume(context: HostContext) {
  if (context.surface.ambient) return;
  try {
    localStorage.setItem('vela.player.volume', String(context.surface.video.volume));
    localStorage.setItem('vela.player.muted', String(context.surface.video.muted));
  } catch {}
}
export function nativeAudio(context: HostContext, id: string): NativeAudioTrack | undefined {
  const tracks = Array.from(context.surface.video.audioTracks ?? []);
  const byId = tracks.find((t) => t.id === id);
  if (byId) return byId;
  const preference = context.session.current?.audioTracks.find((t) => t.id === id);
  if (!preference?.language) return undefined;
  const language = (value: string) => {
    try {
      return Intl.getCanonicalLocales(value)[0]?.split('-')[0] ?? '';
    } catch {
      return '';
    }
  };
  const wanted = language(preference.language);
  const matches = wanted ? tracks.filter((t) => language(t.language) === wanted) : [];
  // A language proves identity only when exactly one native track matches.
  return matches.length === 1 ? matches[0] : undefined;
}
export function applyNativeAudio(context: HostContext) {
  const selected = context.tracks.audio ? nativeAudio(context, context.tracks.audio) : undefined;
  if (!selected) return false;
  for (const track of Array.from(context.surface.video.audioTracks ?? [])) track.enabled = track === selected;
  return true;
}
export function pipAvailable(context: HostContext) {
  if (
    context.surface.video.disablePictureInPicture ||
    context.surface.video.readyState < 2 ||
    context.surface.video.videoWidth <= 0 ||
    context.playback.status === 'ended'
  )
    return false;
  return (
    (!!document.pictureInPictureEnabled && !!context.surface.video.requestPictureInPicture) ||
    (!!context.surface.video.webkitSetPresentationMode &&
      !!context.surface.video.webkitSupportsPresentationMode?.('picture-in-picture'))
  );
}
export function fullscreenAvailable(context: HostContext) {
  if (context.media.backend === 'webgpu')
    return !!document.fullscreenEnabled && !!context.surface.fullscreenContainer.requestFullscreen;
  return (
    (!!document.fullscreenEnabled && !!context.surface.fullscreenContainer.requestFullscreen) ||
    (!!context.surface.video.webkitEnterFullscreen &&
      context.surface.video.webkitSupportsFullscreen !== false)
  );
}
