/**
 * Compile-only check of every TypeScript project: the app (with packages/*), the mock server,
 * the web player and the tests. Run from the repository root:
 *
 *   bun tools/typecheck.ts
 *
 * The web player maps `mediabunny` to the pinned dependency's TypeScript source, which does not
 * compile cleanly under the player's settings; diagnostics inside node_modules are counted and
 * reported but do not fail the check. Every diagnostic in Vela's own files does.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const projects = ['apps/vela', 'mock-server', 'modules/vela-player/web', 'tsconfig.test.json'];
// The mock server and the tests take Bun's types from the mock server's own install.
const tsc = join(root, 'node_modules/typescript/bin/tsc');
// Without the compiler there is nothing to check: say so rather than read its absence as a pass.
if (!existsSync(tsc)) {
  console.log(`FAIL typescript is not installed (${tsc}); run bun install first`);
  process.exit(1);
}
/** A compiler diagnostic: `path(line,col): error TSnnnn: …`. Anything else is not one to ignore. */
const DIAGNOSTIC = /\(\d+,\d+\): error TS\d+/;

let failed = false;
for (const project of projects) {
  const started = performance.now();
  const run = Bun.spawnSync([process.execPath, tsc, '--noEmit', '--pretty', 'false', '-p', project], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const lines = `${run.stdout.toString()}${run.stderr.toString()}`.split('\n').filter(Boolean);
  // A diagnostic starts at a line beginning with a path (or "error TS…" for project-level ones);
  // indented lines continue the one before.
  const own: string[] = [];
  let dependency = 0, current: 'own' | 'dependency' = 'own';
  for (const line of lines) {
    if (!/^\s/.test(line)) current = DIAGNOSTIC.test(line) && (line.startsWith('node_modules/') || line.includes('/node_modules/')) ? 'dependency' : 'own';
    if (current === 'own') own.push(line);
    else if (!/^\s/.test(line)) dependency++;
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const ok = own.length === 0 && (run.exitCode === 0 || dependency > 0);
  const note = dependency ? ` (${dependency} diagnostics in dependencies ignored)` : '';
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${project} ${seconds}s${note}`);
  if (!ok) {
    failed = true;
    console.log(own.join('\n'));
  }
}
if (failed) process.exit(1);
