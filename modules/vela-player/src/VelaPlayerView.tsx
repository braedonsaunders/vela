// VelaPlayerView and VelaPlayer on native platforms (Apple: AetherEngine) behind the player view
// contract (packages/player-api). Props are typed objects; events carry the shapes of
// modules/vela-player/web/engine/model.ts. Media credentials go to the native side through VelaPlayer only.
import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import { createElement, useEffect, useState, useSyncExternalStore } from 'react';
import { redactMediaError } from './media-error';
import { Platform } from 'react-native';
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';
import type {
  Command,
  Failure,
  MediaAccess,
  PlaybackPlan,
  PreviewSource,
  PlayerCapabilities,
  PlayerMetadata,
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
  generation: number;
}

interface NativeModule {
  sampleUIFrames?(enabled: boolean): Promise<Record<string, number>>;
  capabilities(): PlayerCapabilities;
  attachPlaybackURL(plan: string, source: string, authorized: string, generation: number): boolean;
  detachPlaybackURL(plan: string, generation: number): void;
  setMediaAccess(access: NativeMediaAccess | null): void;
  claimPlayPause?(claimed: boolean): void;
  addListener?(event: 'onClaimedPlayPause', listener: () => void): { remove(): void };
}

interface NativeViewProps {
  plan?: PlaybackPlan;
  mediaAuthorization?: { planId: string; generation: number; nonce: number; ok: boolean };
  onMediaAuthorization?: () => void;
  preview?: PreviewSource;
  active?: boolean;
  metadata?: PlayerMetadata;
  command?: Command;
  ambient?: boolean;
  tile?: number;
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
const apple = Platform.OS === 'ios';

/** UI display-link intervals for opt-in benchmarks; missed opportunities are not GPU measurements. */
export const sampleUIFrames = (enabled: boolean): Promise<Record<string, number> | undefined> =>
  nativeModule.sampleUIFrames?.(enabled) ?? Promise.resolve(undefined);

/** The app takes the remote's play/pause (Apple: the system's toggle command, which a playing player
 * otherwise receives) and hears it through `onPress`, until the returned function releases it. */
export function claimPlayPause(onPress: () => void): () => void {
  if (!apple || !nativeModule.claimPlayPause || !nativeModule.addListener) return () => {};
  const subscription = nativeModule.addListener('onClaimedPlayPause', onPress);
  nativeModule.claimPlayPause(true);
  return () => {
    subscription.remove();
    nativeModule.claimPlayPause?.(false);
  };
}

let accessGeneration = 0;
let preparationSequence = 0;
let authorization: { access: MediaAccess; generation: number; requiresHeaders: boolean; ready: Promise<void> } | null = null;
const accessListeners = new Set<() => void>();
const subscribeAccess = (callback: () => void) => { accessListeners.add(callback); return () => { accessListeners.delete(callback); }; };
const accessVersion = () => accessGeneration;
const planIdentity = (plan: PlaybackPlan) => `${plan.sessionId}:${plan.sourceGeneration}:${plan.seekGeneration}:${plan.revision}:${plan.selectedPathId}`;

/** What AetherEngine plays on Apple devices: originals of these families, never converted by the server.
 * A constant until the native side probes VideoToolbox and the audio route. */
export const VelaPlayer: VelaPlayerModule = {
  // The native side probes the device (hardware decoders) rather than declaring a fixed list.
  capabilities: async () => nativeModule.capabilities(),
  setMediaAccess(access: MediaAccess | null) {
    const generation = ++accessGeneration;
    if (!access) {
      authorization = null;
      nativeModule.setMediaAccess(null);
    } else {
      const current = { access, generation, requiresHeaders: false, ready: Promise.resolve() };
      current.ready = access.headers().then(headers => {
        if (generation !== accessGeneration) return;
        current.requiresHeaders = Object.keys(headers).length > 0;
        nativeModule.setMediaAccess({ origin: access.origin, pathPrefix: access.pathPrefix, headers, generation });
      }).catch(() => {
        if (generation === accessGeneration) nativeModule.setMediaAccess(null);
        throw new Error('Media authorization is unavailable');
      });
      void current.ready.catch(() => undefined);
      authorization = current;
    }
    for (const listener of accessListeners) listener();
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
  const version = useSyncExternalStore(subscribeAccess, accessVersion, accessVersion);
  const [request, setRequest] = useState(0);
  const [nativePlan, setNativePlan] = useState<PlaybackPlan>();
  const [result, setResult] = useState<NativeViewProps['mediaAuthorization']>();
  useEffect(() => {
    if (!apple) return;
    let cancelled = false;
    const plan = props.plan;
    const key = plan ? planIdentity(plan) : '';
    let generation = accessGeneration;
    void (async () => {
      // Let the trusted host's effect install this session's grant first.
      await new Promise(resolve => setTimeout(resolve, 0));
      const current = authorization;
      generation = current?.generation ?? accessGeneration;
      try {
        await current?.ready;
        if (cancelled || generation !== accessGeneration) return;
        const path = plan?.paths.find(path => path.id === plan.selectedPathId);
        if (path?.transport === 'hls' && path.readiness === 'ready' && path.url && current?.requiresHeaders) {
          if (!current.access.nativeURL) throw new Error('Native authorization unavailable');
          const url = await current.access.nativeURL(path.url);
          if (cancelled || generation !== accessGeneration) return;
          if (!nativeModule.attachPlaybackURL(key, path.url, url, generation)) throw new Error('Native authorization refused');
        }
        if (!cancelled) {
          setNativePlan(plan);
          setResult(plan ? { planId: key, generation, nonce: ++preparationSequence, ok: true } : undefined);
        }
      } catch {
        // Adapter errors may contain credentialed URLs: emit only a static result.
        if (!cancelled && generation === accessGeneration) {
          setNativePlan(plan);
          setResult(plan ? { planId: key, generation, nonce: ++preparationSequence, ok: false } : undefined);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (key) nativeModule.detachPlaybackURL(key, generation);
    };
  }, [props.plan, version, request]);
  return createElement(NativeView, {
    plan: apple ? nativePlan : props.plan,
    ...(apple ? { mediaAuthorization: result, onMediaAuthorization: () => setRequest(value => value + 1) } : {}),
    preview: props.preview,
    active: props.active,
    metadata: props.metadata,
    command: props.command,
    ambient: props.ambient,
    tile: props.tile,
    serverError: props.serverError ? { ...props.serverError, message: redactMediaError(props.serverError.message) } : null,
    onSnapshot: forward(props.onSnapshot),
    onError: forward<Failure>(error => props.onError?.({ ...error, message: redactMediaError(error.message) })),
    onObservation: forward(props.onObservation),
    onCommand: forward(props.onCommand),
    onSessionCommand: forward(props.onSessionCommand),
    onSessionRefresh: forward(props.onSessionRefresh),
    style: props.style,
  });
}

export type { VelaPlayerViewProps, MediaAccess };
