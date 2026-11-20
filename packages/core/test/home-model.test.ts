import { describe, expect, test } from 'bun:test';
import { homeModel, viewerAvatar } from '../src/discovery/models';
import type { Bootstrap } from '../src/wire';

const feature = { available: false };
const row = (id: string, items: unknown[]) => ({ id, name: id, purpose: 'recentlyAdded', receiptToken: '', items, continuation: 'exhausted' });
const channel = (id: string) => ({ kind: 'channel', receiptToken: '', channel: { id, name: id, artwork: [] } });

const bootstrap = (rows: unknown[]) =>
  ({
    viewer: { id: 'v', name: 'Viewer' },
    defaultSkinId: 'cinematic',
    capabilities: { skins: [], features: { liveTV: feature, aiSearch: feature, descriptiveSearch: feature } },
    heroes: [],
    rows,
  }) as unknown as Bootstrap;

describe('homeModel', () => {
  test('leaves out a row with nothing in it', () => {
    const model = homeModel(bootstrap([row('resume', [channel('a')]), row('nextup', []), row('latest', [channel('b')])]));
    expect(model.rows.map(r => r.id)).toEqual(['resume', 'latest']);
  });

  test('turns a show hero into a next-up or resume episode action from Home rows', () => {
    const title = (id: string, kind: 'show' | 'episode', extra: object = {}) => ({
      id, kind, name: id, summary: '', genres: [], artwork: [], ...extra,
    });
    const show = title('show', 'show');
    const next = title('next', 'episode', { showId: 'show', seasonNumber: 3, episodeNumber: 7, durationSeconds: 1800,
      watch: { positionSeconds: 240, played: false, favorite: false, watchlisted: false } });
    const data = bootstrap([{ id: 'next-up', name: 'Next Up', purpose: 'nextUp', receiptToken: '', continuation: 'exhausted',
      items: [{ kind: 'title', receiptToken: '', title: next }] }]) as Bootstrap;
    data.heroes = [{ title: show, receiptToken: '', reason: 'featured', action: { kind: 'details', titleId: 'show' } }];
    const action = homeModel(data).heroActions[0]!;
    expect(action).toMatchObject({ action: 'resume', targetId: 'next', targetKind: 'episode', actionLabel: 'Resume S3 · E7' });
    expect(action.progress).toBeCloseTo(240 / 1800);
  });

  test('carries the viewer avatar from the server\'s own origin, and nothing otherwise', () => {
    const images = { origin: 'https://ether.example' };
    const avatar = (url: string) => ({ id: 'v', kind: 'person' as const, tag: '1', sizes: [{ width: 240, height: 240, url }] });
    const data = bootstrap([]);
    expect(homeModel(data, images).viewerAvatar).toBe('');
    data.viewer.avatar = avatar('/vela/v0/images/viewer-avatar-v');
    expect(homeModel(data, images).viewerAvatar).toBe('https://ether.example/vela/v0/images/viewer-avatar-v?w=96');
    expect(viewerAvatar(avatar('https://elsewhere.example/a.png'), images)).toBe('');
    expect(viewerAvatar({ ...avatar(''), sizes: [] }, images)).toBe('');
  });
});
