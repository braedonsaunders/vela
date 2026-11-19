// Packaging is fail-closed: never bundle the distribution's GPL-enabled mpv/FFmpeg.
import { existsSync, readFileSync, mkdirSync, cpSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { auditFiles } from './audit-glibc.mjs';
const here = fileURLToPath(new URL('.', import.meta.url));
const prefix = process.env.VELA_LGPL_PREFIX;
if (process.platform !== 'linux' || !prefix) throw new Error('Linux build requires VELA_LGPL_PREFIX with audited LGPL libraries');
const manifest = JSON.parse(readFileSync(join(prefix, 'provenance.json'), 'utf8'));
if (manifest.mpv?.gpl !== false || manifest.ffmpeg?.gpl !== false || manifest.ffmpeg?.nonfree !== false || !manifest.sources?.length)
  throw new Error('Missing LGPL build provenance');
auditFiles([join(prefix,'lib')]);
const out = resolve(here, '../native-linux');
rmSync(out, { recursive:true, force:true }); mkdirSync(join(out,'lib'), { recursive:true });
for (const entry of manifest.libraries || []) {
  if (!/^lib[^/]+\.so(?:\.[\w.-]+)*$/.test(entry)) throw new Error('Invalid library entry');
  copyFileSync(join(prefix,'lib',entry), join(out,'lib',entry));
}
if (!readdirSync(join(out,'lib')).some(n => n.startsWith('libmpv.so'))) throw new Error('Missing libmpv');
if (!existsSync(join(prefix,'notices'))) throw new Error('Missing dependency license notices and source offer');
cpSync(join(prefix,'notices'),join(out,'notices'), {recursive:true});
cpSync(join(prefix,'provenance.json'),join(out,'provenance.json'));
const result = spawnSync('cc', ['-std=c11','-Wall','-Wextra','-Werror',join(here,'surface.c'),
  '-I'+join(prefix,'include'),'-L'+join(out,'lib'),'-Wl,-rpath-link,'+join(out,'lib'),'-Wl,-rpath,$ORIGIN/lib',
  '-lmpv','-lavcodec','-lavformat','-lavfilter','-lavutil','-lswresample','-lswscale','-lX11','-lXext','-lEGL','-o',join(out,'vela-mpv')], {stdio:'inherit'});
if (result.status !== 0) throw new Error('Native helper compilation failed');
const deps = spawnSync('ldd',[join(out,'vela-mpv')], {encoding:'utf8',env:{...process.env,LD_LIBRARY_PATH:join(out,'lib')}});
if (deps.status !== 0 || deps.stdout.includes('not found')) throw new Error('Native library closure incomplete');

const audit = spawnSync(join(out,'vela-mpv'),['--audit'],{env:{...process.env,LD_LIBRARY_PATH:join(out,'lib')},timeout:5000});
if (audit.status !== 0) throw new Error('FFmpeg runtime LGPL audit failed');

const abiReport=auditFiles([out]);
console.log(`Native payload: ${abiReport.files.length} ELF files, maximum GLIBC_${abiReport.maximum}`);
