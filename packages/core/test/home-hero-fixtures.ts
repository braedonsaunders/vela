import { PlexAdapter } from '../src/adapter/plex';
import { JellyfinAdapter } from '../src/adapter/jellyfin';
import { FakeCredentials, routeFetch } from './helpers';

/** The same source-shaped fixture drives adapter assertions and browser bootstrap captures. */
export async function featuredFixture(provider: 'plex' | 'jellyfin') {
  const source = [
    { id: 'resume', name: 'The Last Observatory', progress: 80 },
    { id: 'next', name: 'Arrival', episode: true },
    { id: 'recent', name: 'Letters from Lisbon' },
    { id: 'show', name: 'Meridian Station', show: true },
    { id: 'duplicate', name: 'Another episode', episode: true },
    ...['four','five','six','seven'].map(id => ({ id, name: `Featured ${id}` })),
    { id: 'no-backdrop', name: 'Poster only', missing: true, progress: 120 },
  ];
  const ids = ['resume','next','recent','show','four','five'];
  if (provider === 'plex') {
    const items = source.map(x => ({ ratingKey: x.id, title: x.name, type: 'episode' in x ? 'episode' : 'show' in x ? 'show' : 'movie',
      thumb: `/library/metadata/${x.id}/thumb`, ...(!('missing' in x) ? { art: `/library/metadata/${x.id}/art`, clearLogo: `/library/metadata/${x.id}/logo` } : {}),
      ...('episode' in x ? { grandparentRatingKey: 'series', grandparentTitle: 'Meridian Station', grandparentArt: '/library/metadata/series/art', grandparentClearLogo: '/library/metadata/series/logo', grandparentThumb: '/library/metadata/series/thumb', parentIndex: 1, index: 2 } : {}),
      duration: 3600000, viewOffset: (x.progress ?? 0) * 1000,
    }));
    routeFetch({ 'GET /identity': { MediaContainer: { machineIdentifier: 'plex', friendlyName: 'Plex fixture', version: '1' } },
      'GET /livetv/dvrs': { MediaContainer: {} }, 'GET /media/providers': { MediaContainer: {} },
      'GET /hubs': { MediaContainer: { Hub: [
        { key: '/hubs/home/continueWatching', Metadata: [items[0],items.at(-1)], size: 2 },
        { key: '/hubs/home/onDeck', Metadata: [items[1]], size: 1 },
        { key: '/hubs/home/recentlyAdded', Metadata: items.slice(2), size: items.length-2 },
      ] } },
    });
    return { home: await new PlexAdapter({ origin: 'https://media.example', credentials: new FakeCredentials(), clientIdentifier: 'test' }).home(), ids };
  }
  const items = source.map(x => ({ Id: x.id, Name: x.name, Type: 'episode' in x ? 'Episode' : 'show' in x ? 'Series' : 'Movie',
    ImageTags: { Primary: `poster-${x.id}`, Logo: `logo-${x.id}` }, ...(!('missing' in x) ? { BackdropImageTags: [`backdrop-${x.id}`] } : {}),
    ...('episode' in x ? { SeriesId: 'series', SeriesName: 'Meridian Station', SeriesPrimaryImageTag: 'series-poster', ParentBackdropImageTags: ['series-backdrop'], ParentLogoImageTag: 'series-logo', ParentIndexNumber: 1, IndexNumber: 2 } : {}),
    RunTimeTicks: 36000000000, UserData: { PlaybackPositionTicks: (x.progress ?? 0) * 10000000 },
  }));
  routeFetch({ 'GET /jf/System/Info/Public': { Id: 'jellyfin', ServerName: 'Jellyfin fixture', Version: '1' },
    'GET /jf/QuickConnect/Enabled': false, 'GET /jf/LiveTv/Info': {},
    'GET /jf/Users/viewer-1/Items/Resume': { Items: [items[0],items.at(-1)] },
    'GET /jf/Shows/NextUp': { Items: [items[1]] },
    'GET /jf/Users/viewer-1/Items/Latest': items.slice(2),
  });
  return { home: await new JellyfinAdapter('https://media.example/jf', new FakeCredentials()).home(), ids };
}
