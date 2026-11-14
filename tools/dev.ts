/** One foreground owner for the mock and Exact dev loop. `bun tools/dev.ts stop` shuts down only this owner. */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { open, mkdir, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createConnection } from 'node:net';

const root = resolve(import.meta.dir, '..');
// Ownership metadata is tiny and must survive external scratch-drive disconnects.
const statePath = join(root, '.tools/vela-dev/owner.json');
const legacyStatePath = join(homedir(), '.scratch/tmp/vela/dev/owner.json');
interface Owner { pid: number; repo: string; token: string; controlPort: number; startedAt: string; stateFile?: string }
const mockPort = 7777, webPort = 8765;
const urls = { app: `http://127.0.0.1:${webPort}`, mock: `http://127.0.0.1:${mockPort}` };
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; } }
async function readOwner(): Promise<Owner | undefined> {
  for (const path of [statePath, legacyStatePath]) {
    try { return { ...JSON.parse(await readFile(path, 'utf8')), stateFile: path }; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Cannot read Vela owner file ${path}; another instance may be starting`); }
  }
}
async function removeOwnState(owner: Owner) { const current = await readOwner(); if (current?.token === owner.token) await unlink(current.stateFile ?? statePath); }

const command = process.argv[2];
if (command && command !== 'stop') throw new Error('Usage: bun tools/dev.ts [stop]');
const previous = await readOwner();
if (command === 'stop') {
  if (!previous) { console.log('Vela dev is not running.'); process.exit(0); }
  if (!alive(previous.pid)) { await removeOwnState(previous); console.log(`Removed stale Vela dev owner ${previous.pid}; no process was signalled.`); process.exit(0); }
  if (!previous.controlPort) throw new Error(`Vela dev owner PID ${previous.pid} is still starting; retry stop shortly`);
  const response = await fetch(`http://127.0.0.1:${previous.controlPort}/stop`, { method: 'POST', headers: { Authorization: `Bearer ${previous.token}` }, signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!response.ok) throw new Error(`Owner PID ${previous.pid} refused shutdown; no other process was stopped`);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && (await readOwner())?.token === previous.token) await Bun.sleep(100);
  if ((await readOwner())?.token === previous.token) throw new Error(`Owner PID ${previous.pid} has not completed shutdown`);
  console.log(`Stopped Vela dev owner PID ${previous.pid}.`); process.exit(0);
}
if (previous) {
  if (alive(previous.pid)) throw new Error(`Vela dev already has owner PID ${previous.pid} (${previous.repo}). Use bun tools/dev.ts stop.`);
  await removeOwnState(previous);
}
await mkdir(dirname(statePath), { recursive: true });
const owner: Owner = { pid: process.pid, repo: root, token: crypto.randomUUID(), controlPort: 0, startedAt: new Date().toISOString() };
const lock = await open(statePath, 'wx', 0o600).catch(async e => { const current = await readOwner(); throw new Error(`Vela dev already has owner PID ${current?.pid ?? 'starting'}: ${e.code}`); });
await lock.writeFile(JSON.stringify(owner)); await lock.close();
const children: ChildProcess[] = [];
let stopping = false, controller: ReturnType<typeof Bun.serve> | undefined;
async function shutdown(code: number) {
  if (stopping) return; stopping = true;
  console.log(`Stopping Vela dev owner PID ${owner.pid}...`);
  // Every group below was spawned by this owner, never adopted from a port/PID scan.
  for (const child of children) if (child.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') console.error(e); }
  await Bun.sleep(500);
  for (const child of children) if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') console.error(e); }
  await removeOwnState(owner); controller?.stop(true); process.exit(code);
}
async function occupied(port: number): Promise<boolean> {
  return new Promise(resolve => { const socket = createConnection({ host: '127.0.0.1', port }); const done = (yes: boolean) => { socket.destroy(); resolve(yes); }; socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.setTimeout(500, () => done(false)); });
}
function start(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const child = spawn(bun, args, { cwd, env, stdio: 'inherit', detached: true }); children.push(child);
  child.once('error', error => { console.error(error); void shutdown(1); });
  child.once('exit', (code, signal) => { if (!stopping) { console.error(`${args.join(' ')} exited ${code ?? signal}`); void shutdown(code || 1); } });
}
const pinned = join(root, '.tools/bun-darwin-aarch64/bun'), bun = existsSync(pinned) ? pinned : process.execPath;
try {
  if (process.platform === 'win32') throw new Error('Vela dev process ownership currently requires macOS or Linux process groups');
  for (const port of [mockPort, webPort]) if (await occupied(port)) {
    const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' });
    const pids = [...(result.stdout ?? '').matchAll(/^p(\d+)$/gm)].map(m => m[1]);
    throw new Error(`Port ${port} is already owned by PID ${pids.join(', ') || 'unknown'}. Stop its existing owner before starting Vela; this command will not adopt or kill it.`);
  }
  controller = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    if (req.headers.get('authorization') !== `Bearer ${owner.token}`) return new Response(null, { status: 403 });
    if (req.method === 'POST' && new URL(req.url).pathname === '/stop') { setTimeout(() => void shutdown(0), 25); return Response.json({ stopping: true, pid: owner.pid }); }
    return Response.json({ pid: owner.pid, repo: root, urls, children: children.map(c => c.pid) });
  } });
  owner.controlPort = controller.port!;
  const state = await open(statePath, 'r+'); await state.truncate(); await state.writeFile(JSON.stringify(owner)); await state.close();
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(signal, () => void shutdown(0));
  const env = { ...process.env, PATH: `${dirname(bun)}:${process.env.PATH ?? ''}`, PLAYWRIGHT_SKIP_BROWSER_GC: '1', VELA_MOCK: '1', API_BASE_URL: urls.mock, DEV_ORIGIN: urls.app, PORT: String(mockPort) };
  start(['run', 'mock-server/main.ts'], root, env);
  // Let the catalogue listener become ready before Exact starts requesting its bootstrap.
  for (let n = 0; n < 50 && !await occupied(mockPort); n++) await Bun.sleep(100);
  if (!await occupied(mockPort)) throw new Error('Mock did not start on port 7777');
  start(['exact.mjs', 'web', '--port', String(webPort)], join(root, 'client'), env);
  console.log(`Vela dev owner PID ${owner.pid}\nApp: ${urls.app}\nMock: ${urls.mock}\nSign in: demo / vela\nStop: bun tools/dev.ts stop`);
} catch (error) { console.error(error instanceof Error ? error.message : error); await shutdown(1); }
