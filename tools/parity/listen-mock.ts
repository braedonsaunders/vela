// Start the mock for a Listen parity run: LISTEN_MOCK_ENV (pinned dates, liked titles) with silent
// media. Run it in the foreground; a fresh one per capture set (see capture-listen-web.ts).
//
//   bun tools/parity/listen-mock.ts --port 7951 --dev-origin http://localhost:8951 --media <silent video dir> --music <silent music dir>
//
// The silent media come from `VELA_MOCK_SILENT_MEDIA=1 VELA_MOCK_MEDIA_ROOT=<dir> bun mock-server/scripts/make-media.ts`
// and `bun tools/parity/silent-music.ts --to <dir>`.
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { LISTEN_MOCK_ENV } from './listen-views';

const { values } = parseArgs({ options: { port: { type: 'string', default: '7951' }, 'dev-origin': { type: 'string' }, media: { type: 'string' }, music: { type: 'string' } } });
if (!values.media || !values.music) throw new Error('--media and --music (silent fixture directories) are required');
const child = Bun.spawn(['bun', 'run', resolve(import.meta.dir, '../../mock-server/main.ts')], {
  stdout: 'inherit', stderr: 'inherit',
  env: { ...process.env, ...LISTEN_MOCK_ENV, PORT: values.port!, ...(values['dev-origin'] ? { DEV_ORIGIN: values['dev-origin'] } : {}),
    VELA_MOCK_MEDIA_ROOT: resolve(values.media), VELA_MOCK_MUSIC_ROOT: resolve(values.music) },
});
// The mock music plugin's album note (a listen.album.panel slot surface) is new with the documents;
// the parity runs compare today's pages, so it is hidden from viewers (the slot draws nothing).
const base = `http://127.0.0.1:${values.port}`;
for (let tries = 0; tries < 60; tries++) {
  const answer = await fetch(`${base}/__admin/screens`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hide: ['music.albumNote'] }) }).catch(() => undefined);
  if (answer?.ok) break;
  await Bun.sleep(500);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { child.kill(); process.exit(0); });
process.exitCode = await child.exited;
