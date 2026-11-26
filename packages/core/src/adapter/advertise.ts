import type * as V from '../wire';
import type { ServerAdapter, ServerDescription } from './index';
import {
  hasAiSearch,
  hasAudioFallback,
  hasDescriptiveSearch,
  hasDeviceGrantSignIn,
  hasHistoryRecap,
  hasLibraryDuplicates,
  hasMediaDownloads,
  hasLiveTv,
  hasLibraryLive,
  hasMusicLibrary,
  
  hasMultiview,
  hasPasswordSignIn,
  hasPlaylistImports,
  hasReading,
  hasProactiveFallback,
  hasQuickConnectSignIn,
  hasTrackChanges,
  hasTrailerPreviews,
  hasUnifiedSearch,
  hasVersions,
  hasViewerPlaylists,
} from './capabilities';

type FeatureName = Exclude<keyof V.ServerCapabilities['features'], 'downloads'>;

const NOT_OFFERED: V.Feature = { available: false, reason: 'Not offered by this server' };

/**
 * The capabilities the foundation sees. A feature that is an operation is available only when
 * the adapter implements its capability and the server states it available, so the two cannot
 * disagree. A feature that describes core answers (extras, theme music) is the server's statement.
 */
export function advertise(adapter: ServerAdapter, description: ServerDescription): V.ServerCapabilities {
  const stated = (name: FeatureName): V.Feature => description.features[name] ?? NOT_OFFERED;
  const operation = (name: FeatureName, implemented: boolean): V.Feature => implemented ? stated(name) : NOT_OFFERED;
  return {
    ...description,
    features: {
      passwordSignIn: operation('passwordSignIn', hasPasswordSignIn(adapter)),
      deviceGrant: operation('deviceGrant', hasDeviceGrantSignIn(adapter)),
      quickConnect: operation('quickConnect', hasQuickConnectSignIn(adapter)),
      descriptiveSearch: operation('descriptiveSearch', hasDescriptiveSearch(adapter)),
      aiSearch: operation('aiSearch', hasAiSearch(adapter)),
      ...(hasUnifiedSearch(adapter) && description.features.unifiedSearch ? { unifiedSearch: description.features.unifiedSearch } : {}),
      proactiveFallback: operation('proactiveFallback', hasProactiveFallback(adapter)),
      liveTV: operation('liveTV', hasLiveTv(adapter)),
      ...(hasLiveTv(adapter) && description.features.liveCatchUp ? { liveCatchUp: description.features.liveCatchUp } : {}),
      ...(description.features.livePreview ? { livePreview: description.features.livePreview } : {}),
      libraryLive: operation('libraryLive', hasLibraryLive(adapter)),
      trailerPreview: operation('trailerPreview', hasTrailerPreviews(adapter)),
      audioFallback: operation('audioFallback', hasAudioFallback(adapter)),
      sessionTrackChanges: operation('sessionTrackChanges', hasTrackChanges(adapter)),
      removeFromContinue: stated('removeFromContinue'),
      extras: stated('extras'),
      extraPlayback: stated('extraPlayback'),
      themeMusic: stated('themeMusic'),
      initialTrackSelection: stated('initialTrackSelection'),
      versions: operation('versions', hasVersions(adapter)),
      ...(hasViewerPlaylists(adapter) && description.features.playlists
        ? { playlists: description.features.playlists }
        : {}),
      // Media classes (docs/media-kinds.md): stated by the server; reading also needs the adapter.
      ...(description.features.mediaClasses ? { mediaClasses: description.features.mediaClasses } : {}),
      ...(description.features.audioPlayback ? { audioPlayback: description.features.audioPlayback } : {}),
      ...(description.features.libraryExperiences ? { libraryExperiences: description.features.libraryExperiences } : {}),
      ...(hasMediaDownloads(adapter) && description.features.downloads ? { downloads: description.features.downloads } : {}),
      ...(hasReading(adapter) && description.features.reading ? { reading: description.features.reading } : {}),
      // Multiview: an operation, so the adapter must offer it too.
      ...(hasMultiview(adapter) && description.features.multiview ? { multiview: description.features.multiview } : {}),
      // Music (docs/media-kinds.md): liked lists, lyrics and play contexts are operations the adapter must offer.
      ...(hasMusicLibrary(adapter) && description.features.favoritesList ? { favoritesList: description.features.favoritesList } : {}),
      ...(hasMusicLibrary(adapter) && description.features.lyrics ? { lyrics: description.features.lyrics } : {}),
      ...(hasMusicLibrary(adapter) && description.features.playContexts ? { playContexts: description.features.playContexts } : {}),
      ...(hasMusicLibrary(adapter) && description.features.continuation ? { continuation: description.features.continuation } : {}),
      ...(hasHistoryRecap(adapter) && description.features.historyRecap ? { historyRecap: description.features.historyRecap } : {}),
      ...(hasPlaylistImports(adapter) && description.features.playlistImport ? { playlistImport: description.features.playlistImport } : {}),
      ...(hasLibraryDuplicates(adapter) && description.features.duplicates ? { duplicates: description.features.duplicates } : {}),
      // Queued (gapless next-track) sessions are a property of the server's playback: stated by it.
      ...(description.features.queuedPlayback ? { queuedPlayback: description.features.queuedPlayback } : {}),
      // Loudness describes fields on existing answers (track cards, audio plans): stated by the server.
      ...(description.features.loudness ? { loudness: description.features.loudness } : {}),
      // Plugin levels describe answers to existing reads (rows per tab, children per role): stated by the server.
      ...(description.features.pluginLevels ? { pluginLevels: description.features.pluginLevels } : {}),
    },
  };
}

/** The server's description, advertised for this adapter. */
export async function capabilitiesOf(adapter: ServerAdapter): Promise<V.ServerCapabilities> {
  return advertise(adapter, await adapter.describe());
}
