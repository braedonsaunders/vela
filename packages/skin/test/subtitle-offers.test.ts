import { expect, test } from 'bun:test';
import { subtitleOfferFacts } from '../src/widgets/player/subtitle-offers';

test('an offer shows the facts that decide a pick as chips and its standing as one line', () => {
  expect(subtitleOfferFacts({ id: 'a', name: 'Film.nl', language: 'nl', provider: 'OpenSubtitles', format: 'srt', downloads: 48213, rating: 8.66, releaseMatch: true, hearingImpaired: true, author: 'jan' }, 'nl'))
    .toEqual({ chips: ['Matches this release', 'Hearing impaired', 'OpenSubtitles', 'SRT'], status: '48,213 downloads · Rated 8.7 · by jan' });
});

test('an AI translation says so first; one download is singular; nothing unknown is invented', () => {
  expect(subtitleOfferFacts({ id: 'ai', name: 'Dutch (from English)', language: 'nl', provider: 'Ether', aiTranslated: true, forced: true, downloads: 1 }, 'nl'))
    .toEqual({ chips: ['AI translation', 'Forced', 'Ether'], status: '1 download' });
  expect(subtitleOfferFacts({ id: 'b', name: 'Film', language: 'nl' }, 'nl')).toEqual({ chips: [], status: '' });
});

test('an offer in another variant of the language than the one searched names its own', () => {
  const regional = subtitleOfferFacts({ id: 'c', name: 'Film', language: 'pt-BR' }, 'pt').chips;
  expect(regional).toHaveLength(1);
  expect(regional[0]).toContain('Portuguese');
  expect(subtitleOfferFacts({ id: 'd', name: 'Film', language: 'dut' }, 'nl').chips).toEqual([]);
});
