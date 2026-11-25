import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// Build hosts provide their existing Kotlin compiler; no test framework or Android runtime needed.
const compiler = process.env.VELA_KOTLINC || Bun.which('kotlinc');
// Dev machines keep scratch output on ~/.scratch; CI runners have no such folder.
const scratchRoot = existsSync(join(homedir(), '.scratch/tmp')) ? join(homedir(), '.scratch/tmp') : tmpdir();
(compiler ? test : test.skip)('Android production recovery and scoped HTTP run on the JVM', async () => {
  const scratch = await mkdtemp(join(scratchRoot, 'vela-android-native-'));
  const source = join(import.meta.dir, '../android/src/main/java/app/ether/vela/player');
  const fixtures = join(import.meta.dir, 'fixtures/android');
  try {
    const sources = ['PlaybackPlan', 'PlaybackBuffering', 'PathRecovery', 'MediaScope', 'MediaFailure', 'VideoCapabilities', 'MediaAccess', 'ScopedMediaDataSource'].map(f => join(source, f + '.kt'));
    const stubs = ['Uri', 'Common', 'DataSource', 'Probe'].map(f => join(fixtures, f + '.kt'));
    const compile = Bun.spawn([compiler!, ...sources, ...stubs, '-include-runtime', '-d', join(scratch, 'probe.jar')], { stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(compile.stderr).text();
    expect(await compile.exited, output).toBe(0);
    const runtime = process.env.VELA_KOTLIN_STDLIB;
    const run = Bun.spawn(['java', '-cp', [join(scratch, 'probe.jar'), runtime].filter(Boolean).join(':'), 'app.ether.vela.player.ProbeKt'], { stdout: 'pipe', stderr: 'pipe' });
    expect(await run.exited, await new Response(run.stderr).text()).toBe(0);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}, 60_000);

(compiler ? test : test.skip)('Android display matching, format facts, subtitle appearance and output preferences run on the JVM', async () => {
  const scratch = await mkdtemp(join(scratchRoot, 'vela-android-formats-'));
  const source = join(import.meta.dir, '../android/src/main/java/app/ether/vela/player');
  try {
    const sources = ['DisplayModes', 'AvFormats', 'SubtitleLook', 'DolbyVision', 'AssSample', 'MatroskaAttachments', 'OutputPreferences', 'PictureInPictureShape', 'VisualizerAudio', 'VisualizerTier'].map(f => join(source, f + '.kt'));
    const probe = join(import.meta.dir, 'fixtures/android/FormatProbe.kt');
    const compile = Bun.spawn([compiler!, ...sources, probe, '-include-runtime', '-d', join(scratch, 'formats.jar')], { stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(compile.stderr).text();
    expect(await compile.exited, output).toBe(0);
    const runtime = process.env.VELA_KOTLIN_STDLIB;
    const run = Bun.spawn(['java', '-cp', [join(scratch, 'formats.jar'), runtime].filter(Boolean).join(':'), 'app.ether.vela.player.FormatProbeKt'], { stdout: 'pipe', stderr: 'pipe' });
    expect(await run.exited, await new Response(run.stderr).text()).toBe(0);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}, 60_000);

// The libdovi JNI bridge built for the host (VELA_DOVI_HOST_DIR holds libvela_dovi.so), against dovi_tool's
// test RPUs (VELA_DOVI_ASSETS is its assets/tests directory). See modules/vela-player/android/dovi/build.sh.
const doviHost = process.env.VELA_DOVI_HOST_DIR, doviAssets = process.env.VELA_DOVI_ASSETS;
(compiler && doviHost && doviAssets ? test : test.skip)('Android libdovi bridge converts Profile 7 RPUs to 8.1', async () => {
  const scratch = await mkdtemp(join(scratchRoot, 'vela-android-dovi-'));
  const source = join(import.meta.dir, '../android/src/main/java/app/ether/vela/player');
  try {
    const compile = Bun.spawn([compiler!, join(source, 'DolbyVision.kt'), join(import.meta.dir, 'fixtures/android/DoviProbe.kt'),
      '-include-runtime', '-d', join(scratch, 'dovi.jar')], { stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(compile.stderr).text();
    expect(await compile.exited, output).toBe(0);
    const runtime = process.env.VELA_KOTLIN_STDLIB;
    const run = Bun.spawn(['java', `-Djava.library.path=${doviHost}`, '-cp', [join(scratch, 'dovi.jar'), runtime].filter(Boolean).join(':'),
      'app.ether.vela.player.DoviProbeKt', doviAssets!], { stdout: 'pipe', stderr: 'pipe' });
    expect(await run.exited, await new Response(run.stderr).text()).toBe(0);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}, 60_000);

const cxx = Bun.which('c++');
(cxx ? test : test.skip)('Android visualizer short FFT is Blackman-windowed dB from the last 1024 heard samples', async () => {
  const scratch = await mkdtemp(join(scratchRoot, 'vela-android-spectrum-'));
  try {
    const native = join(import.meta.dir, '../android/visualizer');
    const exe = join(scratch, process.platform === 'win32' ? 'spectrum.exe' : 'spectrum');
    const compile = Bun.spawn([cxx!, '-std=c++17', '-I', native, join(native, 'analyser.cpp'),
      join(import.meta.dir, 'fixtures/android/VisualizerSpectrum.cpp'), '-o', exe], { stderr: 'pipe' });
    expect(await compile.exited, await new Response(compile.stderr).text()).toBe(0);
    expect(await Bun.spawn([exe]).exited).toBe(0);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
