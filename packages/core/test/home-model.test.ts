import { describe, expect, test } from 'bun:test';
import { homeModel } from '../src/discovery/models';
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
});
