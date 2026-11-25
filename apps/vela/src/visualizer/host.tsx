// The app's visualizer, offered to the `visualizer` rich block and to a document's Now Playing
// (packages/skin/src/blocks/listen/visualizer.tsx): the stage, and the per-profile On/Off switch
// while what plays could be visualized. The dock's own Now Playing (media/audio.tsx) keeps its
// direct wiring.
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { currentInQueue } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { VisualizerHostContext, type VisualizerHost, type VisualizerSwitch } from '@vela/skin/src/blocks/listen/visualizer';
import { useCanVisualize } from './availability';
import { visualizerPlan, visualizerProfile } from './selection';
import { setVisualizerEnabled, subscribeVisualizerScene, visualizerEnabled } from './setting';
import { Visualizer } from './visualizer';

function useSwitch(): VisualizerSwitch | undefined {
  const profile = useVelaState(s => visualizerProfile(s.servers.selectedId, s.auth.viewerId || s.auth.viewer));
  const on = useSyncExternalStore(subscribeVisualizerScene, () => visualizerEnabled(profile), () => visualizerEnabled(profile));
  const music = useVelaState(s => currentInQueue(s.audio.queue)?.media?.class === 'music');
  const capable = useCanVisualize(music);
  const offered = visualizerPlan(capable, on, false).switch;
  return useMemo(() => (offered ? { on, onToggle: (next: boolean) => setVisualizerEnabled(profile, next) } : undefined), [offered, on, profile]);
}

const HOST: VisualizerHost = { Stage: Visualizer, useSwitch };

export function VisualizerProvider({ children }: { children: ReactNode }) {
  return <VisualizerHostContext.Provider value={HOST}>{children}</VisualizerHostContext.Provider>;
}
