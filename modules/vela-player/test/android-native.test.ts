import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Build hosts provide their existing Kotlin compiler; no test framework or Android runtime needed.
const compiler = process.env.VELA_KOTLINC || Bun.which('kotlinc');
(compiler ? test : test.skip)('Android production recovery and scoped HTTP run on the JVM', async () => {
  const scratch = await mkdtemp(join(homedir(), '.scratch/tmp/vela-android-native-'));
  const source = join(import.meta.dir, '../android/src/main/java/app/ether/vela/player');
  const fixtures = join(import.meta.dir, 'fixtures/android');
  try {
    const sources = ['PlaybackPlan', 'PathRecovery', 'MediaScope', 'MediaFailure', 'MediaAccess', 'ScopedMediaDataSource'].map(f => join(source, f + '.kt'));
    const stubs = ['Uri', 'Common', 'DataSource', 'Probe'].map(f => join(fixtures, f + '.kt'));
    const compile = Bun.spawn([compiler!, ...sources, ...stubs, '-d', join(scratch, 'probe.jar')], { stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(compile.stderr).text();
    expect(await compile.exited, output).toBe(0);
    const runtime = process.env.VELA_KOTLIN_STDLIB;
    const run = Bun.spawn(['java', '-cp', [join(scratch, 'probe.jar'), runtime].filter(Boolean).join(':'), 'app.ether.vela.player.ProbeKt'], { stdout: 'pipe', stderr: 'pipe' });
    expect(await run.exited, await new Response(run.stderr).text()).toBe(0);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}, 60_000);
