import type { BrowserRuntimeServices } from './services';
import { CoreQuality } from '../core/quality';
import { readSubtitlePreferences } from '../universal/subtitles/preferences';
import type { EngineEvent } from '../model';
import { SessionController } from '../session';
import { LiveLatency } from '../live-latency';
import type { BrowserMediaAccess } from '../media-auth';
import { RecoveryHistory } from '../recovery-history';
import type { HostContext, ExtendedVideo } from './state';
import { checkWaiting } from './watchdog';
import { adaptLive } from './live';
import { adaptCoreQuality } from './quality';
import { publishHostState } from './events';
export function createHostContext(
  video: ExtendedVideo,
  deliver: (event: EngineEvent) => void,
  fullscreenContainer: HTMLElement = video,
  ambient = false,
  mediaAccess?: BrowserMediaAccess,
  runtimes?: BrowserRuntimeServices,
): HostContext {
  const controller = new SessionController();
  const coreQuality = new CoreQuality();
  const browserFallbacks = new Set<string>();
  const subtitleStyle = readSubtitlePreferences();
  const subtitleFailures = new Set<string>();
  const localDecoderRetries = new Set<string>();
  const originalClosing: Promise<void> = Promise.resolve();
  const recoveryHistory = new RecoveryHistory();
  const attempted = new Set<string>();
  const liveLatency = new LiveLatency();
  const context: HostContext = {
    runtimes,
    session: {
      controller: controller,
      current: undefined,
      pendingSwitch: undefined,
      pendingSeek: undefined,
    },
    media: {
      source: undefined,
      pipeline: undefined,
      runtime: undefined,
      runtimeJob: undefined,
      runtimeGeneration: undefined,
      closingRuntime: originalClosing,
      backend: null,
      nativeOrigin: 0,
    },
    watchdog: {
      frameSeen: false,
      videoCallback: undefined,
      startTimer: undefined,
      startupDeadlineMs: 45000,
      waitSince: 0,
      everPlayed: false,
      lastPosition: 0,
      lastAdvance: 0,
    },
    quality: {
      automatic: coreQuality,
      manual: null,
    },
    tracks: {
      deferredPath: null,
      deferredPosition: 0,
      overlay: undefined,
      overlayJob: undefined,
      overlayLoading: undefined,
      overlayEpoch: 0,
      subtitleStyle: subtitleStyle,
      subtitleFailures: subtitleFailures,
      subtitleFailureNotes: [],
      audioPreference: undefined,
      subtitlePreference: undefined,
      audio: null,
      subtitle: null,
      pendingTracks: undefined,
      nativeTrack: undefined,
    },
    recovery: {
      browserFallbacks: browserFallbacks,
      localDecoderRetries: localDecoderRetries,
      history: recoveryHistory,
      attempted: attempted,
      active: false,
    },
    playback: {
      status: 'idle',
      failure: null,
      resumePosition: 0,
      terminalMedia: undefined,
      localIntent: undefined,
      wantsPlay: false,
      speed: 1,
    },
    lifecycle: {
      timer: undefined,
      listeners: [],
      disposed: false,
    },
    live: {
      latency: liveLatency,
      targetSeconds: 12,
      networkRetries: 0,
    },
    telemetry: {
      lastObservation: 0,
    },
    surface: {
      video: video,
      fullscreenContainer: fullscreenContainer,
      ambient: ambient,
      mediaAccess: mediaAccess,
    },
    events: {
      deliver: deliver,
    },
  };
  video.crossOrigin = 'anonymous';
  video.playsInline = true;
  video.controls = false;
  video.preload = 'auto';
  if (ambient) {
    video.defaultMuted = true;
    video.muted = true;
  } else
    try {
      const saved = localStorage.getItem('vela.player.volume');
      if (saved !== null && Number.isFinite(Number(saved)))
        video.volume = Math.max(0, Math.min(1, Number(saved)));
      video.muted = video.muted || localStorage.getItem('vela.player.muted') === 'true';
    } catch {}
  context.lifecycle.timer = setInterval(() => {
    checkWaiting(context);
    adaptLive(context);
    adaptCoreQuality(context);
    publishHostState(context);
  }, 1000);
  return context;
}
