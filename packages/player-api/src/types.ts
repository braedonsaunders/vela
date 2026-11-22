// The player view contract (docs/architecture.md). Every implementation
// (Apple AetherEngine, Android Media3 and the WebCodecs/WebGPU core) takes these props and emits
// these events. The shapes are the browser engine's own
// (modules/vela-player/web/engine/model.ts).
import type { Command, Failure, PlaybackSession, Snapshot } from '../../../modules/vela-player/web/engine/model';
import type {
  ClientCapabilities,
  PlaybackPlan,
  PlayerObservation,
  SessionCommand,
} from '../../protocol/types';

export type { Command, Failure, PlaybackSession, Snapshot, PlaybackPlan, PlayerObservation, SessionCommand };

/** A short muted preview (a card or hero trailer) from the server's preview grant. */
export interface PreviewSource {
  /** Absolute, or relative to the media access origin. */
  url: string;
  mimeType: string;
  /** The grant's expiry (ISO 8601). The view stops then; the host asks for a new grant. */
  expiresAt: string;
  /** Start again from the beginning at the end. */
  loop?: boolean;
  /** Skip trailer preambles; clamped to a quarter of a known duration. */
  startSeconds?: number;
}

/** A full-screen watch's identity for the system's Now Playing. */
export interface PlayerMetadata {
  title: string;
  subtitle?: string;
  /** Absolute, or relative to the media access origin. */
  artworkUrl?: string;
}

export interface VelaPlayerProps {
  /** The session to play. A newer revision or generation of the same session replaces it. */
  session?: PlaybackSession;
  /** A server plan, translated by the implementation; used instead of `session`. */
  plan?: PlaybackPlan;
  /** The latest command. Each id is consumed once; an id at or below the last consumed one is ignored. */
  command?: Command;
  /** A muted preview (hero or live tile): no observations, no fullscreen or picture-in-picture. */
  ambient?: boolean;
  /** One tile (0-based) of a multiview grid: up to four live views playing side by side, each with its
   * own decoder and session. A tile starts muted and becomes the audible one only by a `mute` command;
   * it never claims the system's media controls or the display's mode, and the screen stays awake while
   * any tile plays. Fixed for the view's life: a different role mounts a new view. */
  tile?: number;
  /** A trailer preview instead of a session or plan. Implies ambient; commands are limited to play and
   * pause; onSnapshot reports only its state (loading, playing, ended, failed); no observations. */
  preview?: PreviewSource;
  /** False stops the preview and releases its decoder without unmounting (a card losing hover or focus). */
  active?: boolean;
  /** What the system's Now Playing shows (Control Center, the remote's info). Ambient and preview views never
   * claim the system's media controls; the remote's play, pause and skip take the command paths. */
  metadata?: PlayerMetadata;
  /** A failure the server reported for this session; the view stops and reports it as its own state. */
  serverError?: Failure | null;
  /** Emit position/state throughout playback, including buffering and pause. The shared host
   * watches progress for session recovery; paused/ended states disable its stall deadline. */
  onSnapshot?: (snapshot: Snapshot) => void;
  /** Network/source failures reach the host after engine-local read retries are exhausted.
   * The host replaces the server session; engines must accept a different sessionId in plan. */
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
  /** A credentialed URL for one native-element attachment, minted on request and confined to the native attachment. */
  nativeURL?(url: string): Promise<string>;
}

/** What this device plays through the player view, for the client's negotiation request. */
export type PlayerCapabilities = Omit<ClientCapabilities, 'device' | 'protocolVersions'>;

/** The imperative side every implementation exports as `VelaPlayer`. */
export interface VelaPlayerModule {
  setMediaAccess(access: MediaAccess | null): void;
  /** Probed once per page or process; the controller adds the device and protocol versions. */
  capabilities(): Promise<PlayerCapabilities>;
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
