import { expect, test } from 'bun:test';
import { detailModel } from '../src/discovery/models';
import type { MediaSummary, TitleDetail } from '../src/wire';

const detail: TitleDetail = {
  title: { id: 'pacific-rim', kind: 'movie', name: 'Pacific Rim', summary: '', genres: [], artwork: [] },
  extras: [], chapters: [], cast: [],
};
const facts = (mediaSummary?: MediaSummary) => detailModel({ ...detail, mediaSummary }).mediaFacts;

test('many tracks produce three compact facts, using the preferred audio rather than every language', () => {
  const audio: MediaSummary['audio'] = Array.from({ length: 20 }, (_, i) => ({ codec: 'aac', channels: 2, language: `language-${i}` }));
  audio[7] = { codec: 'truehd', channels: 8, language: 'eng', default: true };
  expect(facts({ video: [{ width: 3840, height: 1600, colorTransfer: 'smpte2084' }], audio, subtitleCount: 28 })).toEqual([
    '4K · HDR10', 'TrueHD · 7.1', '20 audio · 28 subtitles',
  ]);
});

test('older Ether summaries need neither a preferred track nor a subtitle count', () => {
  expect(facts({ video: [{ width: 1920, height: 800, colorTransfer: 'bt709' }], audio: [
    { codec: 'eac3', channels: 6, language: 'eng' }, { codec: 'aac', channels: 2, language: 'fra' },
  ] })).toEqual(['1080p', 'Dolby Digital Plus · 5.1', '2 audio']);
  expect(facts({ video: [], audio: [{ codec: 'aac', channels: 2 }] })).toEqual(['AAC · 2.0']);
  expect(facts()).toEqual([]);
});

test('HDR labels stay short and counts include only supplied track information', () => {
  expect(facts({ video: [{ width: 3840, height: 2160, colorTransfer: 'smpte2084', dolbyVisionProfile: 8 }], audio: [], subtitleCount: 1 }))
    .toEqual(['4K · Dolby Vision', '1 subtitle']);
  expect(facts({ video: [{ height: 720, colorTransfer: 'arib-std-b67' }], audio: [{ channels: 1 }], subtitleCount: 0 }))
    .toEqual(['720p · HLG', '1.0']);
});
