import type * as V from '../wire';
import type { ServerAdapter, ServerDescription } from './index';
import {
  hasAiSearch,
  hasAudioFallback,
  hasDescriptiveSearch,
  hasDeviceGrantSignIn,
  hasLiveTv,
  hasPasswordSignIn,
  hasProactiveFallback,
  hasQuickConnectSignIn,
  hasTrackChanges,
  hasTrailerPreviews,
} from './capabilities';

type FeatureName = keyof V.ServerCapabilities['features'];

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
      proactiveFallback: operation('proactiveFallback', hasProactiveFallback(adapter)),
      liveTV: operation('liveTV', hasLiveTv(adapter)),
      trailerPreview: operation('trailerPreview', hasTrailerPreviews(adapter)),
      audioFallback: operation('audioFallback', hasAudioFallback(adapter)),
      sessionTrackChanges: operation('sessionTrackChanges', hasTrackChanges(adapter)),
      extras: stated('extras'),
      extraPlayback: stated('extraPlayback'),
      themeMusic: stated('themeMusic'),
      initialTrackSelection: stated('initialTrackSelection'),
    },
  };
}

/** The server's description, advertised for this adapter. */
export async function capabilitiesOf(adapter: ServerAdapter): Promise<V.ServerCapabilities> {
  return advertise(adapter, await adapter.describe());
}
