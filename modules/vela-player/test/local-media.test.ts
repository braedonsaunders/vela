import { describe, expect, spyOn, test } from 'bun:test';
import { localMediaPolicy, localMediaURL } from '../web/engine/local-media';

describe('local media URL scope', () => {
  for (const origin of ['https://vela.example', 'vela-app://app', 'http://vela.localhost']) {
    test(`allows only a valid download path on ${origin}`, () => {
      const route = origin + '/vela-downloads/';
      expect(localMediaURL(route + 'server/viewer/title/media.mp4', origin)?.href)
        .toBe(route + 'server/viewer/title/media.mp4');
      expect(localMediaURL(route + 'server/viewer/title/%E2%98%83.vtt', origin)?.href)
        .toBe(route + 'server/viewer/title/%E2%98%83.vtt');
      for (const path of ['', 'a//x', 'a/../x', 'a/%2e/x', '../vela-downloads/x', 'a/%2Fetc',
        'a/%5cetc', 'a\\x', 'a/%00x', 'a/c%3A/x', 'a/%252f', 'a/x?', 'a/x#', 'a/%zz']) {
        expect(localMediaURL(route + path, origin)).toBeUndefined();
      }
      expect(localMediaURL(origin + '/vela-downloads-copy/movie.mp4', origin)).toBeUndefined();
      expect(localMediaURL(origin + '/movie.mp4', origin)).toBeUndefined();
      expect(localMediaURL('https://elsewhere.example/vela-downloads/a.mp4', origin)).toBeUndefined();
    });
  }

  test('requires a blob issued on the page origin', () => {
    const origin = 'https://vela.example';
    expect(localMediaURL('blob:https://vela.example/uuid', origin)?.protocol).toBe('blob:');
    expect(localMediaURL('blob:https://vela.example:444/uuid', origin)).toBeUndefined();
    expect(localMediaURL('blob:http://vela.example/uuid', origin)).toBeUndefined();
    expect(localMediaURL('blob:https://vela.example.evil/uuid', origin)).toBeUndefined();
    expect(localMediaURL('blob:https://vela.example/uuid/extra', origin)).toBeUndefined();
    expect(localMediaURL('blob:null/uuid', 'null')).toBeUndefined();
  });

  test('refuses a sidecar outside the local scope before fetching', async () => {
    const policy = localMediaPolicy('https://vela.example');
    await expect(policy.fetch('https://vela.example/remote.vtt')).rejects.toThrow('outside the downloads scope');
  });
});

test('local blob reads slice bytes and discard authorization headers', async () => {
  const source = new Blob(['0123456789'], { type: 'video/mp4' });
  const fetchBlob = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(async () => new Response(source), { preconnect: globalThis.fetch.preconnect }),
  );
  try {
    const policy = localMediaPolicy('https://vela.example');
    const url = 'blob:https://vela.example/uuid';
    const response = await policy.fetch(url, { headers: { Range: 'bytes=3-5', Authorization: 'private' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 3-5/10');
    expect(await response.text()).toBe('345');
    expect(await (await policy.fetch(url, { headers: { Range: 'bytes=10-' } })).text()).toBe('');
    expect(fetchBlob).toHaveBeenCalledTimes(1);
    expect(fetchBlob.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
    expect(fetchBlob.mock.calls[0]?.[1]?.headers).toBeUndefined();
  } finally {
    fetchBlob.mockRestore();
  }
});
