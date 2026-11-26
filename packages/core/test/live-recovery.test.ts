import { expect, test } from 'bun:test';
import { liveRestart, liveRestartSeek } from '../src/live/recovery';
import type { PlaybackTarget } from '../src/store/playback';
import type { PlaybackPlan } from '../src/wire';

const programme = { kind: 'programme', id: 'programme', channelId: 'channel', positionSeconds: 12 } as const;
const archive = { channelId: 'channel', programmeId: 'programme', startAt: '2026-11-26T12:00:00Z', endAt: '2026-11-26T13:00:00Z' };
const channel = { kind: 'channel', id: 'channel' } satisfies PlaybackTarget;
const live = { mode: 'adaptive', timeshift: { maxMinutes: 60 }, edgeAt: '2026-11-26T12:20:00Z', liveEdgeSeconds: 600, windowStartSeconds: 100 } as const;

test('archive recovery keeps the programme origin and seeks to the current position', () => {
  expect(liveRestart(programme, { catchUp: archive } as PlaybackPlan, 82, false)).toEqual({
    target: { kind: 'programme', id: 'programme', channelId: 'channel', range: { startAt: archive.startAt, durationSeconds: 3600 } },
    resume: { kind: 'programme', seconds: 82, startAt: archive.startAt },
  });
});

test('archive recovery maps the same broadcast instant when the returned range has a different start', () => {
  const { resume } = liveRestart(programme, { catchUp: archive } as PlaybackPlan, 100, false)!;
  if (resume?.kind !== 'programme') throw new Error('Expected an archive resume point');
  const replacement = {
    catchUp: { ...archive, startAt: '2026-11-26T12:00:20Z' },
    durationSeconds: 300,
  } as PlaybackPlan;
  expect(liveRestartSeek(resume, replacement)).toBe(80);
  expect(liveRestartSeek(resume, { ...replacement, catchUp: archive })).toBe(100);
  expect(liveRestartSeek(resume, { ...replacement, catchUp: undefined })).toBe(100);
  expect(liveRestartSeek({ ...resume, seconds: 10 }, replacement)).toBe(0);
  expect(liveRestartSeek({ ...resume, seconds: 350 }, replacement)).toBe(300);
});

test('Start over seeks within the growing range and rejoins live after Go live', () => {
  const target = { ...programme, from: 'start' } as const;
  const plan = { catchUp: archive, live: { mode: 'startOver', windowStartSeconds: 0, liveEdgeSeconds: 600 } } as PlaybackPlan;
  const restart = liveRestart(target, plan, 82, false)!;
  expect(restart.target).toEqual({ kind: 'programme', id: 'programme', channelId: 'channel', from: 'start' });
  expect(liveRestartSeek({ kind: 'programme', seconds: 82 }, plan)).toBe(82);
  expect(liveRestart(target, { channelId: 'channel', live } as PlaybackPlan, 82, true)).toEqual({ target: channel, resume: { kind: 'edge' } });
});

test('timeshift rebases the saved wall-clock point and detects when it left the window', () => {
  const restart = liveRestart(channel, { live } as PlaybackPlan, 450, false)!;
  expect(restart).toEqual({ target: channel, resume: { kind: 'timeshift', at: Date.parse('2026-11-26T12:17:30Z') } });
  const resume = { kind: 'timeshift', at: Date.parse('2026-11-26T12:17:30Z') } as const;
  const replacement = { ...live, liveEdgeSeconds: 300, edgeAt: '2026-11-26T12:20:10Z', windowStartSeconds: 120 };
  expect(liveRestartSeek(resume, { live: replacement } as PlaybackPlan)).toBe(140);
  expect(liveRestartSeek(resume, { live: { ...replacement, windowStartSeconds: 141 } } as PlaybackPlan)).toBe('evicted');
  expect(liveRestartSeek(resume, { live: { ...replacement, liveEdgeSeconds: 160, windowStartSeconds: 0 } } as PlaybackPlan)).toBe(0);
  expect(liveRestart(channel, { live } as PlaybackPlan, 600, true)).toEqual({ target: channel, resume: { kind: 'edge' } });
});
