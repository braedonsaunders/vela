// The player view contract (docs/rn-migration.md, "Player view contract"). Every implementation
// (Apple and Android on libmpv, web on the WebCodecs/WebGPU core) takes these props and emits
// these events. The shapes are the browser engine's own (client/player/model.ts) until that file
// moves into modules/vela-player at conversion.
import type { Command, Failure, PlaybackSession, Snapshot } from '../../../client/player/model';
import type { PlaybackPlan, PlayerObservation, SessionCommand } from '../../../protocol/v0/types';

export type { Command, Failure, PlaybackSession, Snapshot, PlaybackPlan, PlayerObservation, SessionCommand };

export interface VelaPlayerProps {
  /** The session to play. A newer revision or generation of the same session replaces it. */
  session?: PlaybackSession;
  /** A server plan, translated by the implementation; used instead of `session`. */
  plan?: PlaybackPlan;
  /** The latest command. Each id is consumed once; an id at or below the last consumed one is ignored. */
  command?: Command;
  /** A muted preview (hero or live tile): no observations, no fullscreen or picture-in-picture. */
  ambient?: boolean;
  /** A failure the server reported for this session; the view stops and reports it as its own state. */
  serverError?: Failure | null;
  onSnapshot?: (snapshot: Snapshot) => void;
  onError?: (failure: Failure) => void;
  onObservation?: (event: { sessionId: string; observation: PlayerObservation }) => void;
  /** A command finished: done, or refused with the reason (unsupported, no user activation, stale). */
  onCommand?: (event: { id: number; ok: boolean; failure?: Failure }) => void;
  /** The engine needs the server to apply a session command (a seek, track change, path switch or
   * fallback it initiated): the controller sends it with the adapter and answers with a new plan. */
  onSessionCommand?: (event: { sessionId: string; command: SessionCommand }) => void;
  /** The engine needs a fresh authoritative plan (a stale generation or an expired grant). */
  onSessionRefresh?: (event: { sessionId: string }) => void;
}

/** Media credentials for one server. Only the trusted playback controller holds this; it never
 * reaches props, snapshots, errors, logs or skin documents. */
export interface MediaAccess {
  origin: string;
  pathPrefix: string;
  /** Headers attached only to requests inside origin + pathPrefix, never after a redirect leaves it. */
  headers(): Promise<Record<string, string>>;
  /** A credentialed URL for one native-element attachment, minted on request and never stored (web only). */
  nativeURL?(url: string): Promise<string>;
}

/** The imperative side every implementation exports as `VelaPlayer`. */
export interface VelaPlayerModule {
  setMediaAccess(access: MediaAccess | null): void;
}

/** The web implementation's seam: the browser host the playback lead extracts from
 * engine.ts/web-module.ts, mounted by VelaPlayerView.web.tsx into a react-native-web DOM node. */
export interface WebPlayerHost {
  update(props: VelaPlayerProps): void;
  dispose(): void;
}
export interface WebPlayerHostOptions {
  /** Where the player's static payload lives: `${baseUrl}/player/<digest>/` (decoder packages,
   * worklets, subtitle assets). Not a prop, so skins never see or set it. */
  assetBaseURL: string;
  /** The trusted controller's current media access. */
  access(): MediaAccess | null;
}
export type CreateWebPlayerHost = (
  element: HTMLElement,
  props: VelaPlayerProps,
  options: WebPlayerHostOptions,
) => WebPlayerHost;
