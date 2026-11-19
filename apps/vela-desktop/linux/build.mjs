// Packaging is fail-closed: never bundle the distribution's GPL-enabled mpv/FFmpeg.
import { existsSync, readFileSync, mkdirSync, cpSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here = fileURLToPath(new URL('.', import.meta.url));
const prefix = process.env.VELA_LGPL_PREFIX;
if (process.platform !== 'linux' || !prefix) throw new Error('Linux build requires VELA_LGPL_PREFIX with audited LGPL libraries');
const manifest = JSON.parse(readFileSync(join(prefix, 'provenance.json'), 'utf8'));
if (manifest.mpv?.gpl !== false || manifest.ffmpeg?.gpl !== false || manifest.ffmpeg?.nonfree !== false || !manifest.sources?.length)
  throw new Error('Missing LGPL build provenance');
const out = resolve(here, '../native-linux');
rmSync(out, { recursive:true, force:true }); mkdirSync(join(out,'lib'), { recursive:true });
for (const entry of manifest.libraries || []) {
  if (!/^lib[^/]+\.so(?:\.[\w.-]+)*$/.test(entry)) throw new Error('Invalid library entry');
  cpSync(join(prefix,'lib',entry), join(out,'lib',entry), { dereference:true });
}
if (!readdirSync(join(out,'lib')).some(n => n.startsWith('libmpv.so'))) throw new Error('Missing libmpv');
if (!existsSync(join(prefix,'notices'))) throw new Error('Missing dependency license notices and source offer');
cpSync(join(prefix,'notices'),join(out,'notices'), {recursive:true});
cpSync(join(prefix,'provenance.json'),join(out,'provenance.json'));
const result = spawnSync('cc', ['-std=c11','-Wall','-Wextra','-Werror',join(here,'surface.c'),
  '-I'+join(prefix,'include'),'-L'+join(prefix,'lib'),'-Wl,-rpath,$ORIGIN/lib',
  '-lmpv','-lX11','-lXext','-lEGL','-o',join(out,'vela-mpv')], {stdio:'inherit'});
if (result.status !== 0) throw new Error('Native helper compilation failed');
const deps = spawnSync('ldd',[join(out,'vela-mpv')], {encoding:'utf8',env:{...process.env,LD_LIBRARY_PATH:join(out,'lib')}});
if (deps.status !== 0 || deps.stdout.includes('not found')) throw new Error('Native library closure incomplete');
