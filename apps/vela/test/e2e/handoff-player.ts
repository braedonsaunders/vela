// Run the production session hook and Ether adapter in Chromium. The native bridge is simulated
// so the same buffering snapshots and command translation run without a device or media clock.
import { createElement, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createVela } from '@vela/core';
import { VelaProvider } from '@vela/core/react';
import { usePlaybackSession, type PlaybackSession } from '../../../../packages/skin/src/widgets/player/session';
import { previewSnapshot } from '../../../../modules/vela-player/web/preview-snapshot';

const secrets = new Map<string, string>();
const vela = createVela({
  etherOrigin: location.origin,
  secrets: { get: key => secrets.get(key) ?? null, set: (key, value) => { secrets.set(key, value); } },
  device: { name: 'Chromium handoff fixture', platform: 'android' },
  appVersion: '0.2.79',
  rendererVersion: 20,
  artWidth: 640,
  media: { containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: [],
    hls: true, mse: false, features: { adaptiveHLS: true } },
});
let session: PlaybackSession;
let lastCommand = 0;
const start = Date.now();
const root = createRoot(document.querySelector('main')!);

function Watch() {
  session = usePlaybackSession({ kind: 'title', id: 'title-4-2', positionSeconds: 0 });
  const { command, plan, onSessionCommand } = session.view;
  useEffect(() => {
    if (!plan || command?.type !== 'quality' || command.id <= lastCommand || !command.renditionId?.startsWith('path:')) return;
    lastCommand = command.id;
    onSessionCommand?.({ sessionId: plan.sessionId, command: {
      kind: 'switch', pathId: command.renditionId.slice(5), atSeconds: 0,
      sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration, idempotencyKey: crypto.randomUUID(),
    } });
  }, [command, plan, onSessionCommand]);
  return createElement('output', null, JSON.stringify(plan && {
    handoff: plan.serverHandoff ?? null, path: plan.selectedPathId, source: plan.sourceGeneration, seek: plan.seekGeneration,
    adaptive: plan.paths.find(path => path.id === plan.selectedPathId)?.adaptive ?? false,
    reason: plan.autoSelectionReason?.code ?? null,
  }));
}

export const fixture = {
  async open() {
    await vela.auth.start();
    if (!await vela.auth.signIn('demo', 'vela')) throw new Error('Mock sign-in failed');
    root.render(createElement(VelaProvider, { vela }, createElement(Watch)));
  },
  starve() {
    const clock = Date.now;
    try {
      for (let seconds = 0; seconds <= 32; seconds++) {
        Date.now = () => start + seconds * 1000;
        const { plan, onSnapshot } = session.view;
        if (!plan) throw new Error('No playback plan');
        flushSync(() => onSnapshot?.({
          ...previewSnapshot('playing'), sessionId: plan.sessionId, sourceGeneration: plan.sourceGeneration,
          seekGeneration: plan.seekGeneration, state: seconds % 4 < 2 ? 'playing' : 'buffering',
          loadProgress: seconds * 100_000, bufferAheadSeconds: 1,
        }));
      }
    } finally {
      Date.now = clock;
    }
  },
  bufferingObservation() {
    const { plan, onObservation } = session.view;
    if (!plan) throw new Error('No playback plan');
    onObservation?.({ sessionId: plan.sessionId, observation: {
      sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration,
      idempotencyKey: crypto.randomUUID(), sequence: 1, observedAt: new Date().toISOString(),
      state: 'buffering', selectedPathId: plan.selectedPathId, positionSeconds: 0, playableRanges: [],
    } });
  },
  async close() {
    await vela.playback.stop();
    root.unmount();
  },
};

Object.assign(window, { handoff: fixture });
