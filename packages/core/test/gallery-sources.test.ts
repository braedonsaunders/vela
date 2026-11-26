import { expect, test } from 'bun:test';
import type { ListValue } from '../../protocol/vela-sources';
import type { ScreenDocument } from '../../protocol/screen';
import { mediaGroups } from '../../protocol/fixtures/media';
import { launchMock } from '../../../mock-server/test/launch';
import type { Card } from '../src/models';
import { createVela } from '../src/store';
import { MemoryStore } from './helpers';

const href = 'vela:gallery/probe';
const doc: ScreenDocument = {
  schema: 1, kind: 'screen', renderer: 20, owner: 'vela', experience: 'gallery',
  screen: 'gallery', page: 'probe', version: '1', title: 'Gallery', presentation: 'section',
  sources: {
    timeline: { from: 'vela.photoTimeline', library: 'photos' },
    albums: { from: 'vela.photoAlbums', library: 'photos' },
    people: { from: 'vela.photoPeople', library: 'photos' },
    subject: { from: 'vela.photoPeople', library: 'photos', id: 'person-elena-rivers' },
    album: { from: 'vela.children', id: 'photo-album-1', limit: 1 },
  },
  tree: { type: 'box' },
};

async function withGallery(enabled: boolean, run: (probe: {
  list(name: string): ListValue;
  cards(name: string): Card[];
  error(name: string): string | undefined;
  more(name: string): Promise<unknown>;
}) => Promise<void>) {
  const mock = await launchMock({ VELA_MOCK_GALLERY_FEATURES: enabled ? '1' : '0', VELA_MOCK_GALLERY_SCALE: '240', VELA_MOCK_SILENT_MEDIA: '1' });
  try {
    const code = (await (await fetch(`${mock.url}/__admin/web-code`, { method: 'POST' })).json()).code as string;
    const store = createVela({
      etherOrigin: mock.url, secrets: new MemoryStore(), device: { name: 'Gallery test', platform: 'web' }, appVersion: '0.2.9',
      rendererVersion: 20, media: { containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hls: { native: false, fmp4: false, mpegTs: false }, mse: false } as never,
      page: { origin: mock.url, webCode: code }, artWidth: 640,
    });
    store.screens.provideDocuments(candidate => candidate === href ? doc : undefined);
    await store.auth.start();
    const handle = store.screens.open({ target: { kind: 'screen', id: 'vela.gallery', page: 'probe' }, href });
    const state = () => store.getState().screens.pages[handle.key]!;
    const list = (name: string) => state().sources[name] as ListValue;
    try {
      const deadline = Date.now() + 7000;
      while (state()?.load !== 'ready' || Object.keys(state().pending).length || !Object.keys(doc.sources).every(name => name in state().sources || name in state().errors)) {
        if (Date.now() > deadline) throw new Error('Gallery sources did not settle');
        await Bun.sleep(20);
      }
      await run({
        list,
        cards: name => list(name).items.map(ref => store.screens.records.get(ref.$record)!.value as Card),
        error: name => state().errors[name],
        more: source => store.screens.action(handle.key, { name: 'vela.more', args: { source } }),
      });
    } finally {
      handle.release();
    }
  } finally {
    await mock.stop();
  }
}

test('the baseline serves the original timeline and declares no album or people views', async () => {
  await withGallery(false, async ({ cards, error }) => {
    expect(cards('timeline').map(photo => photo.id)).toEqual(mediaGroups.photos.map(photo => photo.id));
    expect(error('albums')).toBe('unsupported');
    expect(error('people')).toBe('unsupported');
  });
}, 10_000);

test('the Gallery fixture pages the timeline and resolves album and person sequences', async () => {
  await withGallery(true, async ({ list, cards, more }) => {
    const first = list('timeline').items;
    expect(first).toHaveLength(100);
    expect(list('timeline').more).toBe(true);
    await more('timeline');
    expect(list('timeline').items).toHaveLength(200);
    expect(list('timeline').items.slice(0, first.length)).toEqual(first);
    const dates = cards('timeline').map(photo => photo.airDate);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(cards('albums').map(album => [album.name, album.itemCount])).toEqual([['Along the coast', 120], ['A year outdoors', 120]]);
    expect(cards('people').map(person => [person.name, person.itemCount])).toEqual([['Elena Rivers', 120], ['Sam Calder', 120]]);
    const subject = list('subject').items;
    expect(subject).toHaveLength(50);
    await more('subject');
    expect(list('subject').items).toHaveLength(100);
    expect(list('subject').items.slice(0, 50)).toEqual(subject);
    await more('subject');
    expect(list('subject').items).toHaveLength(120);
    expect(list('album').items).toEqual(first.slice(0, 1));
    expect(subject.slice(0, 2)).toEqual([first[0]!, first[3]!]);
    await more('album');
    expect(list('album').items).toEqual([first[0]!, first[2]!]);
  });
}, 10_000);
