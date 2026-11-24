import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

(process.platform === 'darwin' ? test : test.skip)('Apple keeps a sidecar subtitle on from the start, across plans, and turns it off in the player; the report follows track choices the server applies', async () => {
  const scratch = await mkdtemp(join(homedir(), '.scratch/tmp/vela-sidecar-'));
  try {
    const ios = join(import.meta.dir, '../ios');
    const compile = Bun.spawn(['xcrun', 'swiftc', '-module-cache-path', join(scratch, 'modules'),
      ...['PlaybackPlan', 'PlayerReport', 'PlayerState', 'SubtitleAppearance'].map((name) => join(ios, `${name}.swift`)),
      join(import.meta.dir, 'fixtures/subtitle-sidecar.swift'), '-o', join(scratch, 'probe')], {
      env: { ...process.env, DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer' }, stdout: 'pipe', stderr: 'pipe',
    });
    const errors = await new Response(compile.stderr).text();
    expect(await compile.exited, errors).toBe(0);
    const run = Bun.spawn([join(scratch, 'probe')], { stdout: 'pipe', stderr: 'pipe' });
    expect(await run.exited, await new Response(run.stderr).text()).toBe(0);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}, 60_000);
