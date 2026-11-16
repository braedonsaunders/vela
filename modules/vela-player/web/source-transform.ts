// Vela's build-time adaptations of the pinned upstream player (MIT) and its Mediabunny fork (MPL).
// The pinned checkouts stay pristine; each bundler that reads them (Metro for the core on the page,
// Bun for the decoder workers in the asset payload) applies the same chain through this module.
// It runs under Node (Metro's transformer workers) as well as Bun, so it imports with extensions.
import { transformCoreAudio } from './engine/core/audio/transform.ts';
import { transformCoreDemux } from './engine/core/demux/transform.ts';
import { transformUpstreamAudio } from './engine/universal/audio/ffmpeg/upstream-transform.ts';
import { transformUpstreamTransport } from './engine/universal/transport-transform.ts';
import { transformUpstreamVideo } from './engine/universal/video/upstream-transform.ts';

type Transform = (path: string, source: string) => string | null;

/** In the order the qualified core build applied them; each sees the previous one's output. */
const chain: Transform[] = [
  transformUpstreamAudio,
  transformUpstreamVideo,
  (path, source) => transformUpstreamTransport(path, source, false),
  transformCoreDemux,
  transformCoreAudio,
];

/** The adapted source of one pinned upstream file, or null when Vela does not change it. */
export function transformPlayerSource(path: string, source: string): string | null {
  let current = source;
  let changed = false;
  for (const transform of chain) {
    const next = transform(path, current);
    if (next !== null) {
      current = next;
      changed = true;
    }
  }
  return changed ? current : null;
}

/** Every file whose contents decide the adaptation, for bundler cache keys and the source offer. */
export const transformSources = [
  'client/player/core/audio/transform.ts',
  'client/player/core/demux/transform.ts',
  'client/player/universal/audio/ffmpeg/upstream-transform.ts',
  'client/player/universal/audio/ffmpeg/codecs.json',
  'client/player/universal/transport-transform.ts',
  'client/player/universal/video/upstream-transform.ts',
];
