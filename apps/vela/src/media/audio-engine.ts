// The native audio engine (docs/media-kinds.md): the player module's one audio player for the whole
// app (Media3 in a MediaSessionService on Android, AVPlayer with Now Playing and the remote commands
// on Apple), so music keeps playing while the viewer browses, in the background and with the screen
// off. The system's media controls (lock screen, notification, headset, Siri Remote) arrive as
// remote commands and take the same paths as the app's own buttons.
import type { AudioEngine, AudioState } from '@vela/core';
import { currentInQueue } from '@vela/core';
import { createNativeAudioEngine, type NativeAudioAccess, type RemoteAudioCommand } from '@vela/player/src/audio';
import { nativeAudioBridge } from '@vela/player/src/audio-native';

export interface MediaSessionControls {
  play(): void; pause(): void; next(): void; previous(): void; seek(seconds: number): void; skip(delta: number): void;
}

/** The media authorization a URL needs: Jellyfin, Emby and Plex send headers; Ether's URLs carry their own. */
export type AudioAuthorizer = () => Promise<{ origin: string; pathPrefix: string; headers(): Promise<Record<string, string>> } | null>;

let installed: MediaSessionControls | null = null;
let playing = false;

function remote(command: RemoteAudioCommand, seconds?: number): void {
  const controls = installed;
  if (!controls) return;
  switch (command) {
    case 'play': controls.play(); break;
    case 'pause': controls.pause(); break;
    case 'toggle': if (playing) controls.pause(); else controls.play(); break;
    case 'next': controls.next(); break;
    case 'previous': controls.previous(); break;
    case 'seek': if (seconds !== undefined) controls.seek(seconds); break;
    case 'skip': if (seconds !== undefined) controls.skip(seconds); break;
  }
}

function inside(url: string, scope: { origin: string; pathPrefix: string }): boolean {
  try {
    const parsed = new URL(url);
    const directory = scope.pathPrefix.endsWith('/') ? scope.pathPrefix : `${scope.pathPrefix}/`;
    return parsed.origin === scope.origin && (scope.pathPrefix === '/' || parsed.pathname === scope.pathPrefix || parsed.pathname.startsWith(directory));
  } catch {
    return false;
  }
}

/** What the engine last did with sound; the native players keep it to themselves. */
export function audioDiagnostics(): unknown { return null; }

export function createAudioEngine(authorize?: AudioAuthorizer): AudioEngine | null {
  return createNativeAudioEngine(nativeAudioBridge(), {
    onRemote: remote,
    authorize: authorize && (async (url): Promise<NativeAudioAccess | null> => {
      const grant = await authorize().catch(() => null);
      if (!grant || !inside(url, grant)) return null;
      return { origin: grant.origin, pathPrefix: grant.pathPrefix, headers: await grant.headers() };
    }),
  });
}

let shown = '';

/** Keep the system's Now Playing (lock screen, notification, Control Center) in step with the queue. */
export function syncMediaSession(state: AudioState, controls: MediaSessionControls): void {
  installed = controls;
  playing = state.phase === 'playing' || state.phase === 'buffering' || state.phase === 'loading';
  const item = currentInQueue(state.queue);
  const key = item ? `${item.id}|${item.poster ?? ''}` : '';
  if (key === shown) return;
  shown = key;
  const cls = item?.media?.class;
  nativeAudioBridge().nowPlaying(item ? {
    title: item.name,
    artist: item.media?.byline ?? '',
    album: item.media?.parent?.name ?? state.queue?.source?.name ?? '',
    artwork: item.poster ?? '',
    spoken: cls === 'audiobook' || cls === 'podcast',
  } : null);
}
