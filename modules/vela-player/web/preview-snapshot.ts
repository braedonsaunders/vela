// A preview's snapshot: only its state is meaningful; every other field is empty, since a preview
// has no session, tracks or telemetry (docs/rn-migration.md, "Previews").
import type { Snapshot } from '@vela/player-api';
import { readSubtitlePreferences } from './engine/universal/subtitles/preferences';

export type PreviewState = 'loading' | 'playing' | 'ended' | 'failed';

export function previewSnapshot(state: PreviewState): Snapshot {
  return {
    sessionId: null,
    sourceGeneration: 0,
    seekGeneration: 0,
    state,
    sourceId: null,
    strategy: null,
    backend: 'file',
    renditionId: null,
    qualityIds: [],
    capabilities: { pip: false, fullscreen: false, audioSwitch: false },
    lockedQuality: null,
    audioTracks: [],
    subtitleTracks: [],
    renditions: [],
    video: null,
    currentBitrateBps: null,
    requiredBandwidthBps: null,
    bufferAheadSeconds: null,
    throughputHistory: [],
    speed: 1,
    speeds: [1],
    pendingSubtitleTrackId: null,
    chapters: [],
    subtitleError: null,
    subtitleStyle: readSubtitlePreferences(),
    subtitleStyleAvailable: false,
    live: null,
    seekTarget: null,
    waiting: false,
    volume: 0,
    muted: true,
    preparation: null,
    position: 0,
    duration: null,
    playable: [],
    throughputBps: null,
    droppedFrames: null,
    totalFrames: null,
    audioTrackIds: [],
    audioTrackId: null,
    pendingAudioTrackId: null,
    subtitleTrackId: null,
    failure: null,
  };
}
