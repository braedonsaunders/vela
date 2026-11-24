// The native module's audio player (AudioPlayback on Apple and Android) as a NativeAudioBridge.
// A build without it still gets a bridge: every call fails, which the engine reports as a playback error.
import { requireNativeModule } from 'expo-modules-core';
import type { NativeAudioBridge, NativeAudioEvent } from './audio';

interface NativeAudioModule {
  audioLoad?(request: Record<string, unknown>): Promise<void>;
  audioPreload?(request: Record<string, unknown> | null): Promise<void>;
  audioPlay?(): Promise<void>;
  audioPause?(): Promise<void>;
  audioSeek?(seconds: number): Promise<void>;
  audioSetRate?(rate: number): Promise<void>;
  audioUnload?(): Promise<void>;
  audioNowPlaying?(info: Record<string, unknown> | null): Promise<void>;
  addListener?(event: 'onAudio', listener: (event: NativeAudioEvent) => void): { remove(): void };
}

const unavailable = () => { throw new Error('Audio playback is unavailable in this build of Vela'); };

let bridge: NativeAudioBridge | undefined;

/** The one native audio player for the app. */
export function nativeAudioBridge(): NativeAudioBridge {
  if (bridge) return bridge;
  const native = requireNativeModule<NativeAudioModule>('VelaPlayer');
  // Calls are fire-and-forget; a rejection (a malformed request) becomes a failed status natively.
  const call = (present: unknown, run: () => Promise<void>) => {
    if (!present) unavailable();
    void run().catch(() => undefined);
  };
  bridge = {
    load: request => call(native.audioLoad, () => native.audioLoad!({ ...request, access: request.access ?? null })),
    // A build from before gapless playback has no preload: its player ends each item and the store loads the next.
    ...(native.audioPreload ? {
      preload: (request: Parameters<NonNullable<NativeAudioBridge['preload']>>[0]) =>
        void native.audioPreload!(request ? { ...request, access: request.access ?? null } : null).catch(() => undefined),
    } : {}),
    play: () => call(native.audioPlay, () => native.audioPlay!()),
    pause: () => call(native.audioPause, () => native.audioPause!()),
    seek: seconds => call(native.audioSeek, () => native.audioSeek!(seconds)),
    setRate: rate => call(native.audioSetRate, () => native.audioSetRate!(rate)),
    unload: () => call(native.audioUnload, () => native.audioUnload!()),
    nowPlaying: info => { if (native.audioNowPlaying) void native.audioNowPlaying(info ? { ...info } : null).catch(() => undefined); },
    subscribe(listener) {
      const subscription = native.addListener?.('onAudio', listener);
      return () => subscription?.remove();
    },
  };
  return bridge;
}
