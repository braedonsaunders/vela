import scenes from '../../../../packages/visualizer/scenes.json';

export { scenes };
const ids = new Set(scenes.map(scene => scene.id));

/** Use both identities: profile IDs are only unique within their own server. */
export const visualizerProfile = (server: string, viewer: string) => JSON.stringify([server, viewer]);

export function sceneSelection(storage: { get(key: string): string | null; set(key: string, value: string): void }) {
  const cache = new Map<string, string>();
  const listeners = new Set<() => void>();
  const key = (profile: string) => 'visualizer.scene.' + profile;
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    get(profile: string, initial?: string) {
      let saved = cache.get(profile);
      if (saved === undefined) {
        try { saved = storage.get(key(profile)) ?? ''; } catch { saved = ''; }
        cache.set(profile, saved);
      }
      if (ids.has(saved)) return saved;
      return initial && ids.has(initial) ? initial : scenes[0]!.id;
    },
    set(profile: string, id: string) {
      if (!ids.has(id) || cache.get(profile) === id) return;
      cache.set(profile, id);
      try { storage.set(key(profile), id); } catch { /* Still available for this session. */ }
      for (const update of listeners) update();
    },
  };
}

export function adjacentScene(id: string, direction: -1 | 1): string {
  const index = Math.max(0, scenes.findIndex(scene => scene.id === id));
  return scenes[(index + scenes.length + direction) % scenes.length]!.id;
}
