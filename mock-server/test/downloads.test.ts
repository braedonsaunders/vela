import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DownloadGrant, ServerCapabilities, TitleDetail, Tokens } from '../../packages/protocol/types';
import { launchMock } from './launch';

test('original download tickets preserve file identity, support ranges and enforce policy and quota', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vela-mock-download-'));
  const media = Uint8Array.from({ length: 64 }, (_, index) => index);
  await Bun.write(join(root, 'direct.mp4'), new Uint8Array(128));
  await Bun.write(join(root, 'download.mp4'), media);
  const mock = await launchMock({ VELA_MOCK_DOWNLOADS: '1', VELA_MOCK_MEDIA_ROOT: root });
  try {
    const api = `${mock.url}/vela/v0`;
    const device = { id: 'test-downloads', name: 'Test', platform: 'ios', appVersion: '0.2.71' };
    const post = (path: string, body: object, accessToken?: string) => fetch(api + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}`, 'X-Vela-Device-Id': device.id } : {}) },
      body: JSON.stringify(body),
    });
    const { accessToken } = await post('/auth/sign-in', { device, idempotencyKey: 'login', username: 'demo', password: 'vela' }).then(response => response.json()) as Tokens;
    const title = '/titles/title-1-1';
    const mint = (idempotencyKey: string, versionId?: string) => post(`${title}/download`, { idempotencyKey, versionId }, accessToken);
    const error = async (response: Response, status: number, code: string) => {
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    };
    await error(await mint('bad-version', 'unavailable'), 409, 'version_unavailable');
    await error(await post('/titles/show-meridian/download', { idempotencyKey: 'show' }, accessToken), 403, 'download_not_allowed');
    const grant = await mint('first').then(response => response.json()) as DownloadGrant;
    expect(grant).toMatchObject({ byteLength: media.length, mimeType: 'video/mp4', container: 'mp4', sourceId: 'download.mp4' });
    expect(typeof grant.etag).toBe('string');
    expect(await mint('first').then(response => response.json())).toEqual(grant);
    const fresh = await mint('second').then(response => response.json()) as DownloadGrant;
    expect(fresh.etag).toBe(grant.etag);
    expect(fresh.url).not.toBe(grant.url);
    const range = await fetch(mock.url + fresh.url, { headers: { Range: 'bytes=12-15', 'If-Range': fresh.etag } });
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe('bytes 12-15/64');
    expect(range.headers.get('etag')).toBe(grant.etag);
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(media.slice(12, 16));
    const changed = await fetch(mock.url + fresh.url, { headers: { Range: 'bytes=12-15', 'If-Range': '"old"' } });
    expect(changed.status).toBe(200);
    expect(new Uint8Array(await changed.arrayBuffer())).toEqual(media);
    expect((await mint('third')).status).toBe(200);
    await error(await mint('fourth'), 429, 'download_limit');
    const headers = { Authorization: `Bearer ${accessToken}`, 'X-Vela-Device-Id': device.id };
    const caps = await fetch(api + '/capabilities', { headers }).then(response => response.json()) as ServerCapabilities;
    expect(caps.features.downloads).toEqual({ enabled: true, maxPerDay: 3, remainingToday: 0 });

    const write = (idempotencyKey: string, positionSeconds: number, observedAt: string, played?: true) =>
      post(`${title}/watch`, { idempotencyKey, positionSeconds, observedAt, offline: true, played }, accessToken);
    expect((await write('watch-2', 87, '2030-01-02T00:00:00Z')).status).toBe(200);
    expect((await write('watch-1', 3, '2030-01-01T00:00:00Z', true)).status).toBe(200);
    const detail = await fetch(api + title, { headers }).then(response => response.json()) as TitleDetail;
    expect(detail.title.watch).toMatchObject({ positionSeconds: 87, lastViewedAt: '2030-01-02T00:00:00Z' });
    expect((await write('watch-3', 180, '2030-01-03T00:00:00Z', true)).status).toBe(200);
    expect((await write('watch-4', 39, '2030-01-04T00:00:00Z')).status).toBe(200);
    const latest = await fetch(api + title, { headers }).then(response => response.json()) as TitleDetail;
    expect(latest.title.watch).toMatchObject({ played: true, positionSeconds: 39 });
  } finally {
    await mock.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('with the sidecar fixture on, a download grant carries an external WebVTT sidecar behind its ticket', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vela-mock-download-sidecar-'));
  await Bun.write(join(root, 'direct.mp4'), new Uint8Array(16));
  await Bun.write(join(root, 'subtitles.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello\n');
  const mock = await launchMock({ VELA_MOCK_DOWNLOADS: '1', VELA_MOCK_MEDIA_ROOT: root });
  try {
    const api = `${mock.url}/vela/v0`;
    const device = { id: 'test-download-sidecar', name: 'Test', platform: 'android', appVersion: '0.2.79' };
    const post = (path: string, body: object, accessToken?: string) => fetch((path.startsWith('/__') ? mock.url : api) + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}`, 'X-Vela-Device-Id': device.id } : {}) },
      body: JSON.stringify(body),
    });
    const { accessToken } = await post('/auth/sign-in', { device, idempotencyKey: 'login', username: 'demo', password: 'vela' }).then(response => response.json()) as Tokens;
    const plain = await post('/titles/title-1-1/download', { idempotencyKey: 'plain' }, accessToken).then(response => response.json()) as DownloadGrant;
    expect(plain.sourceId).toBe('direct.mp4');
    expect(plain.subtitleTracks).toEqual([]);
    await post('/__admin/sidecar', { enabled: true });
    const grant = await post('/titles/title-1-1/download', { idempotencyKey: 'sidecar' }, accessToken).then(response => response.json()) as DownloadGrant;
    const delivery = grant.subtitleTracks[0]?.delivery;
    expect(delivery).toEqual({ kind: 'external', format: 'webvtt', url: `${grant.url}/subtitles.vtt` });
    const sidecar = await fetch(mock.url + (delivery as { url: string }).url);
    expect(sidecar.status).toBe(200);
    expect(await sidecar.text()).toStartWith('WEBVTT');
    expect((await fetch(`${mock.url}/vela/v0/download/00000000-0000-4000-8000-000000000000/subtitles.vtt`)).status).toBe(404);
  } finally {
    await mock.stop();
    await rm(root, { recursive: true, force: true });
  }
});
