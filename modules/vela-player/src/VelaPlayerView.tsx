// VelaPlayerView and VelaPlayer on native platforms (Apple today: libmpv from MPVKit) behind the player view
// contract (packages/player-api). Props are typed objects; events carry the shapes of
// client/player/model.ts. Media credentials go to the native side through VelaPlayer only.
import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import { createElement } from 'react';
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';
import type {
  Command,
  Failure,
  MediaAccess,
  PlaybackPlan,
  PlayerCapabilities,
  PlayerObservation,
  SessionCommand,
  Snapshot,
  VelaPlayerModule,
  VelaPlayerViewProps,
} from '@vela/player-api';

/** What the native module takes: the headers resolved, for one origin and path prefix. */
interface NativeMediaAccess {
  origin: string;
  pathPrefix: string;
  headers: Record<string, string>;
}

interface NativeModule {
  setMediaAccess(access: NativeMediaAccess | null): void;
}

interface NativeViewProps {
  plan?: PlaybackPlan;
  command?: Command;
  ambient?: boolean;
  serverError?: Failure | null;
  onSnapshot?: (event: NativeSyntheticEvent<Snapshot>) => void;
  onError?: (event: NativeSyntheticEvent<Failure>) => void;
  onObservation?: (event: NativeSyntheticEvent<{ sessionId: string; observation: PlayerObservation }>) => void;
  onCommand?: (event: NativeSyntheticEvent<{ id: number; ok: boolean; failure?: Failure }>) => void;
  onSessionCommand?: (event: NativeSyntheticEvent<{ sessionId: string; command: SessionCommand }>) => void;
  onSessionRefresh?: (event: NativeSyntheticEvent<{ sessionId: string }>) => void;
  style?: StyleProp<ViewStyle>;
}

const nativeModule = requireNativeModule<NativeModule>('VelaPlayer');
const NativeView = requireNativeViewManager<NativeViewProps>('VelaPlayer');

let accessGeneration = 0;

/** What libmpv plays on Apple devices: originals of these families, never converted by the server.
 * A constant until the native side probes VideoToolbox and the audio route. */
const appleCapabilities: PlayerCapabilities = {
  containers: ['mp4'],
  videoCodecs: ['h264', 'hevc'],
  audioCodecs: ['aac', 'ac3', 'eac3'],
  subtitleFormats: ['webvtt', 'srt', 'ass', 'ssa', 'pgs', 'tx3g'],
  hls: true,
  mse: false,
  originalPlayback: {
    version: 1,
    range: true,
    webgpu: false,
    demuxContainers: ['mkv', 'webm', 'mp4', 'mpegts'],
    videoDecoders: ['h264', 'hevc', 'av1', 'vp9', 'mpeg2video', 'vc1'],
    audioDecoders: [
      'aac', 'ac3', 'eac3', 'dts', 'truehd', 'mlp', 'flac', 'alac', 'opus', 'vorbis', 'mp3', 'pcm_s16le', 'pcm_s24le',
    ],
  },
};

export const VelaPlayer: VelaPlayerModule = {
  capabilities: async () => appleCapabilities,
  setMediaAccess(access: MediaAccess | null) {
    const generation = ++accessGeneration;
    if (!access) {
      nativeModule.setMediaAccess(null);
      return;
    }
    // The headers are resolved here and handed over once; JavaScript keeps no copy.
    void access.headers().then((headers) => {
      if (generation === accessGeneration) {
        nativeModule.setMediaAccess({ origin: access.origin, pathPrefix: access.pathPrefix, headers });
      }
    });
  },
};

/** Unwraps a native event's payload for a contract callback. */
function forward<T>(callback?: (value: T) => void) {
  return callback ? (event: NativeSyntheticEvent<T>) => callback(event.nativeEvent) : undefined;
}

export function VelaPlayerView(props: VelaPlayerViewProps) {
  if (props.session && !props.plan) {
    // The Apple implementation translates server plans natively; a pre-translated session is the web engine's input.
    throw new Error('VelaPlayerView on Apple platforms takes `plan`, not `session`');
  }
  return createElement(NativeView, {
    plan: props.plan,
    command: props.command,
    ambient: props.ambient,
    serverError: props.serverError ?? null,
    onSnapshot: forward(props.onSnapshot),
    onError: forward(props.onError),
    onObservation: forward(props.onObservation),
    onCommand: forward(props.onCommand),
    onSessionCommand: forward(props.onSessionCommand),
    onSessionRefresh: forward(props.onSessionRefresh),
    style: props.style,
  });
}

export type { VelaPlayerViewProps, MediaAccess };
