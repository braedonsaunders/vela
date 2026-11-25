// What core's `vela.*` sources need from the app (docs/experiences.md: "Sources for Vela's own
// pages"): the bundled built-in page documents, and the viewer's visualizer setting on this device
// (per profile, never synced), which `vela.visualizer` reads and `vela.setVisualizerScene` sets.
import type { Vela as Store } from '@vela/core';
import { builtinDocument } from '@vela/skin/src/resolve/builtin';
import { visualizerProfile } from './visualizer/selection';
import { getVisualizerScene, setVisualizerScene, subscribeVisualizerScene, visualizerEnabled } from './visualizer/setting';

export function wireLocalSources(store: Store): void {
  store.screens.provideDocuments(builtinDocument);
  const profile = () => {
    const state = store.getState();
    return visualizerProfile(state.servers.selectedId, state.auth.viewerId || state.auth.viewer);
  };
  store.screens.localSources()?.setVisualizer({
    get: () => ({ scene: getVisualizerScene(profile()), enabled: visualizerEnabled(profile()) }),
    set: id => setVisualizerScene(profile(), id),
    subscribe: listener => {
      // Another profile signed in reads its own choice.
      let seen = profile();
      const offProfile = store.subscribe(() => {
        const next = profile();
        if (next === seen) return;
        seen = next;
        listener();
      });
      const offScene = subscribeVisualizerScene(listener);
      return () => { offProfile(); offScene(); };
    },
  });
}
