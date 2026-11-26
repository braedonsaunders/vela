import { expect, test } from 'bun:test';
import type { Device, Page, Library, TitleDetail, Tokens } from '../../packages/protocol/types';
import { launchMock } from './launch';

test('the Gallery parity mock serves four distinct photo states and the existing recommendations', async () => {
  const mock = await launchMock({
    VELA_MOCK_NOW: '2026-11-26T15:00:00.000Z',
    VELA_MOCK_GALLERY_PARITY: '1',
    VELA_MOCK_GALLERY_ROWS: '1',
  });
  try {
    const path = (suffix: string) => mock.url + '/vela/v0' + suffix;
    const device: Device = { id: 'gallery-parity', name: 'Test', platform: 'web', appVersion: '0.2.73' };
    const login = await fetch(path('/auth/sign-in'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'vela', device, idempotencyKey: 'gallery-parity-sign-in' }),
    });
    expect(login.status).toBe(200);
    const tokens = await login.json() as Tokens;
    const headers = { Authorization: `Bearer ${tokens.accessToken}`, 'X-Vela-Device-Id': device.id };
    const get = async <T>(suffix: string): Promise<T> => {
      const response = await fetch(path(suffix), { headers });
      expect(response.status).toBe(200);
      return await response.json() as T;
    };
    const libraries = await get<Page<Library>>('/libraries');
    expect(libraries.items.find(library => library.id === 'photos')?.tabs?.map(tab => tab.id)).toEqual(['recommended', 'library']);
    for (const [id, wide, facts] of [
      ['harbour-at-dawn', true, true],
      ['orchard-in-fog', false, true],
      ['lighthouse-path', true, false],
      ['first-snow', false, false],
    ] as const) {
      const { title } = await get<TitleDetail>(`/titles/photo-${id}`);
      expect(title.artwork.some(art => art.kind === 'thumb')).toBe(wide);
      expect(title.artwork.find(art => art.kind === 'poster')?.sizes[0]).toMatchObject({ width: 300, height: 300 });
      expect(Boolean(title.media?.facts?.length)).toBe(facts);
    }
  } finally {
    await mock.stop();
  }
});
