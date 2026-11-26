import { describe, expect, test } from 'bun:test';
import {
  analyzePress, cpuIn, jsSources, parseProbe, parseProbeJs, pressStarts, settlingMount, sumCounts, summarize,
  type TraceEvents,
} from './tv-nav-analysis';
import { deviceScript, formatComparison, parseEvents, runTotals, type RunReport } from './tv-nav';

const ms = (value: number) => value * 1e6;
const span = (at: number, dur: number) => ({ ts: ms(at), dur: ms(dur) });

describe('tv-nav press analysis', () => {
  test('a press is its key-down: its key-up and repeats within the gap belong to it', () => {
    expect(pressStarts([span(0, 1), span(80, 1), span(1200, 1), span(1290, 1)])).toEqual([0, ms(1200)]);
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
    const commits = [{ ts: ms(19), comps: 80, hosts: 2, top: 'Box:4', upd: 'RCTView:3', src: 'Box:1' }];
    const press = analyzePress(events, commits, 'row →', 0, ms(1000));
    expect(press).toMatchObject({ focusMs: 2, mountMs: 21, frameMs: 30, settleMs: 70, jsMs: 25, mainMs: 4, renderMs: 16,
      mounts: 2, frames: 3, commits: 1, comps: 80, top: 'Box:4', updated: 'RCTView:3', sources: 'Box:1' });
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
    const events = parseEvents('"kind","ts","dur"\n"key",100,5\n"frame",200,50\n"js",300,10\n"main",400,-1\n');
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
    expect(deviceScript([{ key: 'DPAD_DOWN', window: 1500 }, { wait: 2000 }, { key: 'DPAD_RIGHT', burst: 3, window: 4000 }])).toBe([
      '#!/system/bin/sh',
      'input keyevent --duration 80 KEYCODE_DPAD_DOWN', 'sleep 1.5',
      'sleep 2',
      'input keyevent KEYCODE_DPAD_RIGHT KEYCODE_DPAD_RIGHT KEYCODE_DPAD_RIGHT', 'sleep 4',
    ].join('\n') + '\n');
  });

  test('a comparison reads before and after side by side', () => {
    const report = (label: string, js: number): RunReport => ({
      label, scenario: 'home', serial: 'e', measuredAt: '', presses: [], warnings: [],
      summary: Object.fromEntries(['focusMs', 'mountMs', 'frameMs', 'settleMs', 'jsMs', 'mainMs', 'renderMs', 'mounts', 'frames', 'commits', 'comps']
        .map(m => [m, { n: 1, median: m === 'jsMs' ? js : 1, p90: m === 'jsMs' ? js : 1, total: m === 'jsMs' ? js : 1 }])) as RunReport['summary'],
    });
    expect(formatComparison(report('before', 80), report('after', 20))).toContain('| jsMs | 80 / 80; 80 | 20 / 20; 20 |');
  });
});
