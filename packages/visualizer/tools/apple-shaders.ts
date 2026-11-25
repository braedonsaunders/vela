// Cross-compiles every program the native bundle links (dist/programs.json from build.ts) to Metal.
//   bun packages/visualizer/tools/apple-shaders.ts <dist dir> [--sdk appletvsimulator] [--check]
// GLSL ES 3.00 → SPIR-V (glslang; relaxed Vulkan rules gather the loose uniforms into one block) → MSL (SPIRV-Cross).
// Vertex shaders are built twice: with clip-space Y flipped (every offscreen pass; keeps GL's memory layout, see
// PROTOCOL.md) and as written (passes that draw to the screen). Writes dist/apple-shaders.json, which the Metal
// executor's link() looks up by the exact (vs, fs) source pair. --check also compiles each MSL with `metal`.
// Needs glslang and spirv-cross on PATH (Homebrew: glslang, spirv-cross); a build-time tool only, nothing ships.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const dist = path.resolve(process.argv[2] ?? path.join(import.meta.dir, '../dist'));
const sdk = process.argv.includes('--sdk') ? process.argv[process.argv.indexOf('--sdk') + 1] : 'appletvsimulator';
const check = process.argv.includes('--check');
const programs: { vs: string; fs: string }[] = JSON.parse(fs.readFileSync(path.join(dist, 'programs.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viz-msl-'));
const run = (cmd: string, args: string[]) => { const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? '/Applications/Xcode.app/Contents/Developer' } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };

// GL type enums for link()'s answer.
const GLT: Record<string, number> = { float: 0x1406, vec2: 0x8B50, vec3: 0x8B51, vec4: 0x8B52, mat3: 0x8B5B, mat4: 0x8B5C, int: 0x1404, sampler2D: 0x8B5E };
type Member = { name: string; type: string; offset: number; count: number; arrayStride: number; matrixStride: number };
type Stage = { msl: string; entry: string; ubo: number; uboSize: number; members: Member[]; textures: { name: string; texture: number; sampler: number }[] };

function stage(src: string, st: 'vert' | 'frag', name: string, flip: boolean): { stage: Stage; reflect: any } {
  const g = path.join(tmp, `${name}.${st}`), spv = g + '.spv', msl = g + (flip ? '.flip' : '') + '.metal';
  fs.writeFileSync(g, src.replace('#version 300 es', '#version 310 es'));
  run('glslang', ['-V', '-R', '--amb', '--aml', '-S', st, '-o', spv, g]);
  const entry = `${name}_${st}`;
  run('spirv-cross', [spv, '--msl', '--msl-version', '20300', '--rename-entry-point', 'main', entry, st, '--output', msl, ...(flip ? ['--flip-vert-y'] : [])]);
  const reflect = JSON.parse(run('spirv-cross', [spv, '--reflect']));
  const code = fs.readFileSync(msl, 'utf8');
  if (check) run('xcrun', ['-sdk', sdk, 'metal', '-c', '-std=metal3.0', '-o', msl + '.air', msl]);
  // Slots, from the entry point's own signature (only the resources the stage really uses appear there).
  const sig = code.slice(code.indexOf(`${entry}(`), code.indexOf('{', code.indexOf(`${entry}(`)));
  const ubo = /\[\[buffer\((\d+)\)\]\]/.exec(sig);
  const textures = [...sig.matchAll(/texture2d<float>\s+(\w+)\s+\[\[texture\((\d+)\)\]\]/g)].map(m => {
    const s = new RegExp(`sampler\\s+${m[1]}Smplr\\s+\\[\\[sampler\\((\\d+)\\)\\]\\]`).exec(sig);
    return { name: m[1], texture: +m[2], sampler: s ? +s[1] : +m[2] };
  });
  const u = reflect.ubos?.[0], t = u ? reflect.types[u.type] : null;
  const members: Member[] = t ? t.members.map((m: any) => ({ name: m.name, type: m.type, offset: m.offset, count: m.array ? m.array[0] : 1,
    arrayStride: m.array_stride ?? 0, matrixStride: m.matrix_stride ?? 0 })) : [];
  return { stage: { msl: code, entry, ubo: ubo ? +ubo[1] : -1, uboSize: u ? u.block_size : 0, members, textures }, reflect };
}

const table = programs.map((p, i) => {
  const name = `p${String(i).padStart(3, '0')}`;
  const vs = stage(p.vs, 'vert', name, true), vsScreen = stage(p.vs, 'vert', name, false), fsg = stage(p.fs, 'frag', name, false);
  // link()'s answer: every block member and sampler either stage declares, once.
  const seen = new Map<string, { name: string; type: number; size: number }>();
  for (const s of [vs.stage, fsg.stage]) for (const m of s.members) if (!seen.has(m.name)) seen.set(m.name, { name: m.name, type: GLT[m.type] ?? 0x1406, size: m.count });
  for (const r of [vs.reflect, fsg.reflect]) for (const t of r.textures ?? []) if (!seen.has(t.name)) seen.set(t.name, { name: t.name, type: GLT.sampler2D, size: 1 });
  return { vs: p.vs, fs: p.fs, uniforms: [...seen.values()], stages: { vs: vs.stage, vsScreen: { msl: vsScreen.stage.msl }, fs: fsg.stage } };
});
fs.writeFileSync(path.join(dist, 'apple-shaders.json'), JSON.stringify(table));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`apple-shaders.json: ${table.length} programs, ${(fs.statSync(path.join(dist, 'apple-shaders.json')).size / 1024).toFixed(0)} KB${check ? `, all MSL compiled for ${sdk}` : ''}`);
