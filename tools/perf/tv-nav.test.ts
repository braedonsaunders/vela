import { describe, expect, test } from 'bun:test';
import {
  analyzeLightPress, jsQuietMs, parseCpuSamples, parseFramestats, parseJsSamples, analyzePress, anchorPresses, cpuIn, jsSources, parseMarks, parseProbe, parseProbeJs, pressStarts, settlingMount, sumCounts, summarize,
  type TraceEvents,
} from './tv-nav-analysis';
import { deviceScript, formatComparison, lightScript, parseEvents, parseLabShell, runTotals, type RunReport } from './tv-nav';

const ms = (value: number) => value * 1e6;
const span = (at: number, dur: number) => ({ ts: ms(at), dur: ms(dur) });

describe('tv-nav press analysis', () => {
  test('a press is its key-down: its key-up and repeats within the gap belong to it', () => {
    expect(pressStarts([span(0, 1), span(80, 1), span(1200, 1), span(1290, 1)])).toEqual([0, ms(1200)]);
  });

  test('markers name the presses: each starts at the first key-down after its marker, or at the marker', () => {
    const marks = parseMarks('  10.000000  1 2 I VELANAV : 0\n  12.000000  1 2 I VELANAV : 1\n  12.100000  1 2 I ReactNativeJS: x', 'VELANAV');
    expect(marks).toEqual([10e9, 12e9]);
    // The first press left no input slice; the second's key-down came 300 ms after its marker.
    expect(anchorPresses(marks, [12.3e9, 12.38e9])).toEqual([10e9, 12.3e9]);
  });

  test('CPU time is the scheduled time clipped to the window', () => {
    expect(cpuIn([span(0, 10), span(15, 10), span(40, 5)], ms(5), ms(20))).toBe(10);
  });

  test('a screen comes to rest at the mount followed by a quiet stretch', () => {
    const mounts = [span(10, 2), span(30, 2), span(600, 2)];
    expect(settlingMount(mounts, 400)).toEqual(span(30, 2));
    expect(settlingMount([span(10, 2)], 400)).toEqual(span(10, 2));
  });

  test('a press: focus reaches JS, the first mount applies its answer, a frame shows it', () => {
    const events: TraceEvents = {
      keys: [span(0, 1)],
      focus: [span(2, 0.1)],
      mounts: [span(20, 1), span(60, 1)],
      frames: [span(5, 3), span(22, 8), span(62, 8)],
      sched: { js: [span(3, 15), span(40, 10)], main: [span(0, 4)], render: [span(22, 8), span(62, 8)] },
    };
    // 50 views created from 40 ms on: the content shows with the frame after the mount at 60 ms.
    events.views = Array.from({ length: 60 }, (_, i) => span(40 + i * 0.2, 0.1));
    const commits = [{ ts: ms(19), comps: 80, hosts: 2, top: 'Box:4', upd: 'RCTView:3', src: 'Box:1' }];
    const press = analyzePress(events, commits, 'row →', 0, ms(1000));
    expect(press).toMatchObject({ focusMs: 2, mountMs: 21, frameMs: 30, settleMs: 70, contentMs: 70, jsMs: 25, mainMs: 4, renderMs: 16,
      mounts: 2, frames: 3, commits: 1, comps: 80, top: 'Box:4', updated: 'RCTView:3', sources: 'Box:1' });
  });

  test('a last mount that draws nothing settles where it ends', () => {
    const events: TraceEvents = { keys: [span(0, 1)], focus: [], mounts: [span(20, 1), span(300, 2)],
      frames: [span(22, 8)], sched: { js: [], main: [], render: [] } };
    expect(analyzePress(events, [], 'close', 0, ms(4000)).settleMs).toBe(302);
  });

  test('a summary is the median and p90 of the presses that measured it', () => {
    expect(summarize([3, null, 1, 2, 10])).toEqual({ n: 4, median: 2, p90: 10, total: 16 });
    expect(summarize([null])).toEqual({ n: 0, median: null, p90: null, total: 0 });
  });
});

describe('tv-nav probe and trace parsing', () => {
  test('probe commit lines (logcat -v monotonic) carry time, counts and breakdowns', () => {
    const line = '  123.456789  4283  4300 I ReactNativeJS: VELAPERF commit t=9 comps=78 hosts=1 top=View:30,Box:14 upd=RCTView:31 src=ChromeButton:2';
    expect(parseProbe(line)).toEqual([{ ts: 123.456789e9, comps: 78, hosts: 1, top: 'View:30,Box:14', upd: 'RCTView:31', src: 'ChromeButton:2' }]);
  });

  test('JS time lines sum per press, heaviest first', () => {
    const logcat = [
      '  10.000000  1 2 I ReactNativeJS: VELAPERF js ev=topScroll:2:1.5,topFocus:1:0.5 timer=raf:animate@12:3:2.5 commit=2:12.0',
      '  10.200000  1 2 I ReactNativeJS: VELAPERF js ev=topScroll:1:0.5 timer= commit=0:0.0',
    ].join('\n');
    const windows = parseProbeJs(logcat);
    expect(windows).toHaveLength(2);
    expect(jsSources(windows, 9.9e9, 10.3e9)).toBe('completeRoot:2:12,raf:animate@12:3:2.5,topScroll:3:2,topFocus:1:0.5');
    expect(sumCounts(['a:1,b:2', 'b:3'])).toBe('b:5,a:1');
  });

  test('trace_processor rows split into keys, frames and each thread\'s scheduling', () => {
    const events = parseEvents('"kind","ts","dur"\n"key",100,5\n"frame",200,50\n"view",250,3\n"js",300,10\n"main",400,-1\n');
    expect(events.views).toEqual([{ ts: 250, dur: 3 }]);
    expect(events.keys).toEqual([{ ts: 100, dur: 5 }]);
    expect(events.frames).toEqual([{ ts: 200, dur: 50 }]);
    expect(events.sched.js).toEqual([{ ts: 300, dur: 10 }]);
    expect(events.sched.main).toEqual([{ ts: 400, dur: 0 }]);
  });

  test('a run\'s totals are per second of the run', () => {
    const events: TraceEvents = { keys: [], focus: [], mounts: [], frames: [span(100, 5), span(900, 5)],
      sched: { js: [span(0, 100)], main: [span(0, 50)], render: [] } };
    expect(runTotals(events, 0, ms(2000))).toEqual({ seconds: 2, framesPerSecond: 1, jsMsPerSecond: 50, mainMsPerSecond: 25, renderMsPerSecond: 0 });
  });
});

describe('tv-nav scenarios', () => {
  test('presses are held for 80 ms and paced by the device; bursts go back to back', () => {
    expect(deviceScript([{ link: 'vela://library/1', wait: 500 }, { key: 'DPAD_DOWN', window: 1500 }, { wait: 2000 }, { key: 'DPAD_RIGHT', burst: 3, window: 4000 }])).toBe([
      '#!/system/bin/sh',
      "am start -a android.intent.action.VIEW -d 'vela://library/1' app.ether.vela >/dev/null 2>&1", 'sleep 0.5',
      'log -t VELANAV 0', 'input keyevent --duration 80 KEYCODE_DPAD_DOWN', 'sleep 1.5',
      'sleep 2',
      'log -t VELANAV 1', 'input keyevent KEYCODE_DPAD_RIGHT KEYCODE_DPAD_RIGHT KEYCODE_DPAD_RIGHT', 'sleep 4',
    ].join('\n') + '\n');
  });

  test('older Androids get instant keys; a launch step is measured from its marker', () => {
    expect(deviceScript([{ launch: true, label: 'cold', window: 20000 }, { key: 'DPAD_DOWN', window: 1500 }], false)).toBe([
      '#!/system/bin/sh',
      'log -t VELANAV 0', 'am start -n app.ether.vela/.MainActivity >/dev/null 2>&1', 'sleep 20',
      'log -t VELANAV 1', 'input keyevent KEYCODE_DPAD_DOWN', 'sleep 1.5',
    ].join('\n') + '\n');
  });

  test('the trace clock\'s offset from CLOCK_MONOTONIC comes with the events', () => {
    expect(parseEvents('"clock",86400000000000,0\n"key",100,5\n').monotonicOffset).toBe(86400000000000);
  });

  test('lab shell output splits into the command\'s output, its stderr and exit code', () => {
    expect(parseLabShell('29\n\n[exit 0]\n')).toEqual({ out: '29\n', err: '', exit: 0 });
    expect(parseLabShell('\n[stderr]\nnope\n\n[exit 1]')).toEqual({ out: '', err: 'nope\n', exit: 1 });
  });

  test('a comparison reads before and after side by side', () => {
    const report = (label: string, js: number): RunReport => ({
      label, scenario: 'home', serial: 'e', measuredAt: '', presses: [], warnings: [],
      summary: Object.fromEntries(['focusMs', 'mountMs', 'frameMs', 'settleMs', 'contentMs', 'jsMs', 'mainMs', 'renderMs', 'mounts', 'frames', 'commits', 'comps']
        .map(m => [m, { n: 1, median: m === 'jsMs' ? js : 1, p90: m === 'jsMs' ? js : 1, total: m === 'jsMs' ? js : 1 }])) as RunReport['summary'],
    });
    expect(formatComparison(report('before', 80), report('after', 20))).toContain('| jsMs | 80 / 80; 80 | 20 / 20; 20 |');
  });
});

describe('tv-nav light mode (no kernel tracing)', () => {
  const head = 'Flags,IntendedVsync,Vsync,OldestInputEvent,NewestInputEvent,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,';
  const row = (flags: number, start: number, end: number) => `${flags},${start},${start},0,0,0,0,0,0,0,0,0,0,${end},0,0,`;

  test('frames come once each from repeated framestats dumps; skipped frames are left out', () => {
    const dump = ['---PROFILEDATA---', head, row(0, ms(100), ms(110)), row(0, ms(200), ms(240)), row(1, ms(300), ms(301)), '---PROFILEDATA---'].join('\n');
    const frames = parseFramestats(`${dump}\n${dump}`);
    expect(frames).toEqual([span(100, 10), span(200, 40)]);
  });

  test('a press: its first frame, the frame it settles on, jank, and each thread\'s run time', () => {
    const frames = [span(50, 5), span(120, 30), span(170, 10), span(900, 5)];
    const cpu = parseCpuSamples('p 0 1000000 2000000 3000000\ne 0 81000000 12000000 23000000\n');
    const press = analyzeLightPress(frames, cpu, 0, 'row →', ms(100), ms(1300));
    expect(press).toMatchObject({ frameMs: 50, settleMs: 80, frames: 3, jank: 1, worstMs: 30, jsMs: 80, mainMs: 10, renderMs: 20 });
  });

  test('a launch is interactive where its JS thread goes quiet for two samples in a row', () => {
    const samples = parseJsSamples([
      '  11.500000  1 2 I VELACPU : 1400000000 1 1', '  13.000000  1 2 I VELACPU : 2900000000 1 1',
      '  14.500000  1 2 I VELACPU : 3100000000 1 1', '  16.000000  1 2 I VELACPU : 3200000000 1 1', '  17.500000  1 2 I VELACPU : 3300000000 1 1',
    ].join('\n'));
    // Busy (1 s of each 1.5 s) until 13.0 s, then under a quarter: quiet from 13.0 s, 3 s after launch at 10 s.
    expect(jsQuietMs(samples, 10e9, 20e9)).toBe(3000);
    expect(jsQuietMs(samples.slice(0, 2), 10e9, 20e9)).toBeNull();
  });

  test('the script marks each key after input returns and samples run time around it', () => {
    const script = lightScript([{ key: 'DPAD_DOWN', window: 2000 }], false);
    expect(script).toContain('log -t VELANAV 0\ncpu p 0\ninput keyevent KEYCODE_DPAD_DOWN\nlog -t VELAKEY 0\nwait_ 2000\ncpu e 0');
    expect(script).toContain('dumpsys gfxinfo app.ether.vela framestats');
  });
});
