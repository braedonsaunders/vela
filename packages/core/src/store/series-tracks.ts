// Per-series audio and subtitle track preferences stored on this device, scoped to
// `(serverId, viewerId, showId)`. Preferences are learned only from deliberate viewer picks,
// bounded in size, and pruned when a server is removed.
import {
  MAX_SERIES_TRACKS,
  parseSeriesTrackKey,
  pruneSeriesTracks,
  removeServerSeriesTracks,
  seriesTrackKey,
  storedSeriesTracks,
  trackChoiceOf,
  type SeriesTrackMap,
  type SeriesTrackPreference,
} from '../series-tracks';
import type * as V from '../wire';
import type { Session } from './session';
import type { StateBox } from './state';
import type { VelaState } from './index';

export type SeriesTracksState = SeriesTrackMap;

export const initialSeriesTracks: SeriesTracksState = {};

export class SeriesTracks {
  constructor(
    private readonly box: StateBox<VelaState>,
    session: Session,
  ) {
    session.onForget(serverId => this.removeServer(serverId));
  }

  private get state(): SeriesTracksState {
    return this.box.get().seriesTracks;
  }

  /** Hydrate stored preferences once at launch, keeping any newer picks made before hydration. */
  load(stored: unknown): void {
    const loaded = storedSeriesTracks(stored);
    this.box.update('seriesTracks', current => {
      const merged: SeriesTrackMap = { ...loaded };
      for (const [key, entry] of Object.entries(current)) {
        const prev = merged[key];
        if (!prev || entry.updatedAt >= prev.updatedAt) {
          merged[key] = {
            ...prev,
            ...entry,
            updatedAt: Math.max(prev?.updatedAt ?? 0, entry.updatedAt),
          };
        }
      }
      return pruneSeriesTracks(merged, MAX_SERIES_TRACKS);
    });
  }

  get(serverId: string, viewerId: string, showId: string): SeriesTrackPreference | undefined {
    if (!serverId || !viewerId || !showId) return undefined;
    return this.state[seriesTrackKey(serverId, viewerId, showId)];
  }

  /** Whether this viewer has any remembered series on this server (avoids extra lookups when empty). */
  hasForViewer(serverId: string, viewerId: string): boolean {
    if (!serverId || !viewerId) return false;
    for (const key of Object.keys(this.state)) {
      const parsed = parseSeriesTrackKey(key);
      if (parsed && parsed.serverId === serverId && parsed.viewerId === viewerId) return true;
    }
    return false;
  }

  rememberAudio(serverId: string, viewerId: string, showId: string, track: V.Track, now = Date.now()): void {
    if (!serverId || !viewerId || !showId) return;
    const choice = trackChoiceOf(track);
    if (!choice) return;
    const key = seriesTrackKey(serverId, viewerId, showId);
    this.box.update('seriesTracks', current => {
      const prev = current[key];
      const next: SeriesTrackMap = {
        ...current,
        [key]: { ...(prev ? { subtitle: prev.subtitle } : {}), audio: choice, updatedAt: now },
      };
      return pruneSeriesTracks(next, MAX_SERIES_TRACKS);
    });
  }

  rememberSubtitle(serverId: string, viewerId: string, showId: string, track: V.Track | null, now = Date.now()): void {
    if (!serverId || !viewerId || !showId) return;
    const choice = track === null ? null : trackChoiceOf(track);
    if (choice === null && track !== null) return;
    const key = seriesTrackKey(serverId, viewerId, showId);
    this.box.update('seriesTracks', current => {
      const prev = current[key];
      const next: SeriesTrackMap = {
        ...current,
        [key]: { ...(prev ? { audio: prev.audio } : {}), subtitle: choice, updatedAt: now },
      };
      return pruneSeriesTracks(next, MAX_SERIES_TRACKS);
    });
  }

  removeServer(serverId: string): void {
    if (!serverId) return;
    this.box.update('seriesTracks', current => removeServerSeriesTracks(current, serverId));
  }
}
