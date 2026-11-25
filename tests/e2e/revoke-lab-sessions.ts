import { randomUUID } from 'node:crypto';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const sessionDir = process.argv[2] ?? '';
const configured = process.env.VELA_E2E_SERVER;
if (!configured) throw new Error('VELA_E2E_SERVER is required');
const upstream = new URL(configured);
if (upstream.protocol !== 'http:' || !upstream.hostname.startsWith('192.168.')) throw new Error('cleanup accepts only the private-LAN HTTP Vela lab');
const safeRoot = join(homedir(), '.scratch', 'tmp') + '/';
if (!sessionDir.startsWith(safeRoot) || ((await stat(sessionDir)).mode & 0o777) !== 0o700) throw new Error('unsafe session directory');

type Grant = { accessToken: string; refreshToken: string };
type Handoff = { grant: Grant; device: { id?: unknown } };

async function post(path: string, body: object, grant?: Grant): Promise<Response> {
  const key = randomUUID();
  return fetch(new URL(`/vela/v0${path}`, upstream), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      ...(grant ? { Authorization: `Bearer ${grant.accessToken}` } : {}),
    },
    body: JSON.stringify({ ...body, idempotencyKey: key }),
    signal: AbortSignal.timeout(10_000),
  });
}

let failed = false;
for (const name of await readdir(sessionDir)) {
  if (!/^\d+\.json$/.test(name)) continue;
  const path = join(sessionDir, name);
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Handoff;
    if (!value.grant?.accessToken || !value.grant.refreshToken || typeof value.device?.id !== 'string') throw new Error('invalid cleanup handoff');
    let grant = value.grant;
    const refreshed = await post('/auth/refresh', { refreshToken: grant.refreshToken, device: value.device });
    if (refreshed.ok) grant = await refreshed.json() as Grant;
    else if (refreshed.status !== 401) throw new Error(`refresh HTTP ${refreshed.status}`);
    const revoked = await post('/auth/revoke', { refreshToken: grant.refreshToken }, grant);
    if (!revoked.ok && revoked.status !== 401) throw new Error(`revoke HTTP ${revoked.status}`);
  } catch (error) {
    failed = true;
    console.error(`dedicated viewer cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  } finally {
    await rm(path, { force: true });
  }
}
await rm(sessionDir, { recursive: true, force: true });
if (failed) process.exitCode = 4;
