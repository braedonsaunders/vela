import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const appleTest = process.platform === 'darwin' ? test : test.skip;
const scratch = join(homedir(), '.scratch', 'tmp', `vela-offline-downloads-${process.pid}`);
const binary = join(scratch, 'probe');
let server: ReturnType<typeof Bun.serve> | undefined;
let origin = '';
const seen: { path: string; headers: Headers }[] = [];

beforeAll(async () => {
  if (process.platform !== 'darwin') return;
  await mkdir(scratch, { recursive: true });
  const ios = join(import.meta.dir, '..', 'ios');
  const compiler = Bun.spawn([
    'xcrun',
    'swiftc',
    '-swift-version',
    '5',
    '-module-cache-path',
    join(scratch, 'modules'),
    join(ios, 'PlaybackCacheBudget.swift'),
    join(ios, 'OfflineDownloads.swift'),
    join(import.meta.dir, 'fixtures/offline-downloads-probe.swift'),
    '-o',
    binary,
  ], {
    env: { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [output, errors, status] = await Promise.all([
    new Response(compiler.stdout).text(),
    new Response(compiler.stderr).text(),
    compiler.exited,
  ]);
  if (status !== 0) throw new Error(`OfflineDownloads Swift probe did not compile: ${output}${errors}`);

  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      seen.push({ path: url.pathname, headers: new Headers(req.headers) });
      if (url.pathname === '/media/101.mkv') {
        return new Response('A'.repeat(32), {
          status: 200,
          headers: { 'Content-Type': 'video/x-matroska', ETag: '"etag-101"' },
        });
      }
      if (url.pathname === '/poster/101.jpg') {
        return new Response('JPEGDATA', {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }
      if (url.pathname === '/subs/sub-1.srt') {
        return new Response('1\n00:00:01,000 --> 00:00:03,000\nHello\n', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      if (url.pathname === '/subs/sub-2.ass') {
        return new Response('[Script Info]\nTitle: Test\n', {
          status: 200,
          headers: { 'Content-Type': 'text/x-ssa; charset=utf-8' },
        });
      }
      if (url.pathname === '/redirect') {
        return new Response(null, { status: 302, headers: { Location: url.searchParams.get('to') ?? '/' } });
      }
      if (url.pathname === '/media/slow.mkv') {
        return Bun.sleep(1500).then(() => new Response('A'.repeat(32), { status: 200, headers: { 'Content-Type': 'video/x-matroska' } }));
      }
      if (url.pathname === '/media/truncated.mkv') {
        return new Response('A'.repeat(24), {
          status: 200,
          headers: { 'Content-Type': 'video/x-matroska' },
        });
      }
      if (url.pathname === '/media/range-resume.mkv') {
        const range = req.headers.get('range');
        if (range === 'bytes=16-' && req.headers.get('if-range') === '"etag-resumed"') {
          return new Response('B'.repeat(16), {
            status: 206,
            headers: {
              'Content-Type': 'video/x-matroska',
              'Content-Range': 'bytes 16-31/32',
              ETag: '"etag-resumed"',
            },
          });
        }
        return new Response('A'.repeat(16) + 'B'.repeat(16), {
          status: 200,
          headers: { 'Content-Type': 'video/x-matroska', ETag: '"etag-resumed"' },
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  origin = `http://127.0.0.1:${server.port}`;
}, 60_000);

afterAll(async () => {
  server?.stop(true);
  if (process.platform === 'darwin') await rm(scratch, { recursive: true, force: true });
});

async function runMode(mode: string) {
  seen.length = 0;
  const rootDir = join(scratch, `root-${mode}-${Date.now()}`);
  await mkdir(rootDir, { recursive: true });
  const proc = Bun.spawn([binary, rootDir, origin, mode], { stdout: 'pipe', stderr: 'pipe' });
  const [output, errors, status] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(errors).toBe('');
  expect(status).toBe(0);
  return output.trim();
}

appleTest('OfflineDownloads marks directories and index files excluded from iCloud backup and atomically persists snapshots', async () => {
  expect(await runMode('snapshot')).toBe('snapshot_ok');
});

appleTest('OfflineDownloads verifies downloaded file size, fetches poster and subtitle sidecars with auth headers, and removes viewer storage', async () => {
  expect(await runMode('transfer')).toBe('transfer_ok');
  for (const hit of seen) {
    expect(hit.headers.get('x-plex-token')).toBe('secret-token');
  }
});

appleTest('OfflineDownloads refuses to promote a truncated file whose size does not match byteLength', async () => {
  expect(await runMode('corrupt')).toBe('corrupt_ok');
});

appleTest('OfflineDownloads resumes a partial .part file using Range and If-Range with fresh headers', async () => {
  expect(await runMode('resume-range')).toBe('resume_ok');
  // The first request is the redirect preflight (bytes=0-0); the transfer follows it.
  const rangeHit = seen.find(h => h.path === '/media/range-resume.mkv' && h.headers.get('range') !== 'bytes=0-0');
  expect(rangeHit?.headers.get('range')).toBe('bytes=16-');
  expect(rangeHit?.headers.get('if-range')).toBe('"etag-resumed"');
  expect(rangeHit?.headers.get('x-plex-token')).toBe('fresh-token');
});

appleTest('OfflineDownloads keeps credential headers off disk while a transfer is in flight', async () => {
  expect(await runMode('credentials')).toBe('credentials_ok');
});

appleTest('OfflineDownloads refuses a download redirected to another origin and never sends credentials there', async () => {
  expect(await runMode('redirect')).toBe('redirect_ok');
  expect(seen.some(hit => hit.headers.get('host')?.startsWith('localhost'))).toBe(false);
});
