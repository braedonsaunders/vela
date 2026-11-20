import type { BrowserRuntimeServices } from './services';
import { CoreQuality } from '../core/quality';
import { type OriginalBackend } from '../universal/loader';
import type { SubtitleSession } from '../universal/subtitles/session';
import { readSubtitlePreferences } from '../universal/subtitles/preferences';
import type { EngineEvent, Failure, PlaybackSession, Snapshot, Source } from '../model';
import { SessionController, type Generation } from '../session';
import { SegmentPipeline } from '../pipeline';
import { LiveLatency } from '../live-latency';
import type { BrowserMediaAccess } from '../media-auth';
import { RecoveryHistory } from '../recovery-history';
export interface NativeAudioTrack {
  id: string;
  language: string;
  enabled: boolean;
}
export type ExtendedVideo = HTMLVideoElement & {
  audioTracks?: ArrayLike<NativeAudioTrack>;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
  webkitDisplayingFullscreen?: boolean;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
};
export interface HostSessionState {
  readonly controller: SessionController;
  current?: PlaybackSession;
  pendingSwitch?: {
    startedAt: number;
    sessionId: string;
    sourceId: string;
    source: number;
    seek: number;
    position: number;
    recovery: boolean;
  };
  pendingSeek?: {
    position: number;
    startedAt: number;
    authorized: boolean;
    /** A later target, asked for while the server had yet to answer the seek before it. */
    queued?: boolean;
  };
}
export interface HostMediaState {
  source?: Source;
  pipeline?: SegmentPipeline;
  runtime?: OriginalBackend;
  runtimeJob?: AbortController;
  runtimeGeneration?: Generation;
  closingRuntime: Promise<void>;
  backend: Snapshot['backend'];
  nativeOrigin: number;
}
export interface HostWatchdogState {
  frameSeen: boolean;
  videoCallback?: number;
  startTimer?: ReturnType<typeof setTimeout>;
  startupDeadlineMs: number;
  waitSince: number;
  everPlayed: boolean;
  lastPosition: number;
  lastAdvance: number;
}
export interface HostQualityState {
  readonly automatic: CoreQuality;
  manual: string | null;
}
export interface HostTracksState {
  deferredPath: string | null;
  deferredPosition: number;
  overlay?: SubtitleSession;
  overlayJob?: AbortController;
  overlayLoading?: Promise<SubtitleSession>;
  overlayEpoch: number;
  subtitleStyle: ReturnType<typeof readSubtitlePreferences>;
  subtitleFailures: Set<string>;
  subtitleFailureNotes: string[];
  audioPreference?: string;
  subtitlePreference?: string | null;
  audio: string | null;
  subtitle: string | null;
  pendingTracks?: {
    audio?: string;
    subtitle?: string | null;
    previousSubtitlePreference?: string | null;
    startedAt: number;
  };
  nativeTrack?: HTMLTrackElement;
}
export interface HostRecoveryState {
  readonly browserFallbacks: Set<string>;
  localDecoderRetries: Set<string>;
  readonly history: RecoveryHistory;
  attempted: Set<string>;
  active: boolean;
}
export interface HostPlaybackState {
  status: Snapshot['state'];
  failure: Failure | null;
  resumePosition: number;
  terminalMedia?: {
    position: number;
    duration: number | null;
    frames?: number | null;
    dropped?: number | null;
  };
  localIntent: 'playing' | 'paused' | undefined;
  wantsPlay: boolean;
  speed: number;
}
export interface HostLifecycleState {
  timer: ReturnType<typeof setInterval> | undefined;
  listeners: (() => void)[];
  disposed: boolean;
}
export interface HostLiveState {
  readonly latency: LiveLatency;
  targetSeconds: number;
  networkRetries: number;
  /** Whether the viewer is shown as behind live (held with hysteresis, see behindLive). */
  behind: boolean;
}
export interface HostTelemetryState {
  lastObservation: number;
}
export interface HostSurfaceState {
  video: ExtendedVideo;
  fullscreenContainer: HTMLElement;
  ambient: boolean;
  mediaAccess?: BrowserMediaAccess;
}
export interface HostEventsState {
  deliver: (event: EngineEvent) => void;
}
export interface HostContext {
  readonly runtimes: BrowserRuntimeServices;
  readonly session: HostSessionState;
  readonly media: HostMediaState;
  readonly watchdog: HostWatchdogState;
  readonly quality: HostQualityState;
  readonly tracks: HostTracksState;
  readonly recovery: HostRecoveryState;
  readonly playback: HostPlaybackState;
  readonly lifecycle: HostLifecycleState;
  readonly live: HostLiveState;
  readonly telemetry: HostTelemetryState;
  readonly surface: HostSurfaceState;
  readonly events: HostEventsState;
}
