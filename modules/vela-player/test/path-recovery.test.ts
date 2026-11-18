import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

(process.platform === 'darwin' ? test : test.skip)('Apple recovery selects server paths, prepares once and bounds retries per session', async () => {
  const scratch = await mkdtemp(join(homedir(), '.scratch/tmp/vela-recovery-'));
  try {
    const ios = join(import.meta.dir, '../ios');
    const compile = Bun.spawn(['xcrun', 'swiftc', '-module-cache-path', join(scratch, 'modules'),
      join(ios, 'PlaybackPlan.swift'), join(ios, 'PathRecovery.swift'),
      join(import.meta.dir, 'fixtures/path-recovery.swift'), '-o', join(scratch, 'probe')], {
      env: { ...process.env, DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer' }, stdout: 'pipe', stderr: 'pipe',
    });
    const errors = await new Response(compile.stderr).text();
    expect(await compile.exited, errors).toBe(0);
    const run = Bun.spawn([join(scratch, 'probe')], { stdout: 'pipe', stderr: 'pipe' });
    expect(await run.exited, await new Response(run.stderr).text()).toBe(0);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}, 60_000);
