import scenes from '../../../../packages/visualizer/scenes.json';

export { scenes };
const ids = new Set(scenes.map(scene => scene.id));

/** The scene picker's first entry: no scene, the artwork backdrop. */
export const VISUALIZER_OFF = 'off';

/** Use both identities: profile IDs are only unique within their own server. */
export const visualizerProfile = (server: string, viewer: string) => JSON.stringify([server, viewer]);

type Storage = { get(key: string): string | null; set(key: string, value: string): void };

/** The profile's scene and whether its visualizer is on, on this device. On is the default; turning
 * it off keeps the scene, so turning it on again (or choosing any scene) resumes where it was. */
export function sceneSelection(storage: Storage) {
  const scenesSaved = new Map<string, string>();
  const switches = new Map<string, string>();
  const listeners = new Set<() => void>();
  const sceneKey = (profile: string) => 'visualizer.scene.' + profile;
  const switchKey = (profile: string) => 'visualizer.enabled.' + profile;
  function read(cache: Map<string, string>, key: string, profile: string) {
    let saved = cache.get(profile);
    if (saved === undefined) {
      try { saved = storage.get(key) ?? ''; } catch { saved = ''; }
      cache.set(profile, saved);
    }
    return saved;
  }
  function write(cache: Map<string, string>, key: string, profile: string, value: string) {
    if (read(cache, key, profile) === value) return false;
    cache.set(profile, value);
    try { storage.set(key, value); } catch { /* Still applies for this session. */ }
    return true;
  }
  const notify = () => { for (const update of listeners) update(); };
  const enabled = (profile: string) => read(switches, switchKey(profile), profile) !== VISUALIZER_OFF;
  const setEnabled = (profile: string, on: boolean) => {
    if (write(switches, switchKey(profile), profile, on ? 'on' : VISUALIZER_OFF)) notify();
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    get(profile: string, initial?: string) {
      const saved = read(scenesSaved, sceneKey(profile), profile);
      if (ids.has(saved)) return saved;
      return initial && ids.has(initial) ? initial : scenes[0]!.id;
    },
    /** Choosing a scene turns the visualizer on; choosing `off` turns it off and keeps the scene. */
    set(profile: string, id: string) {
      if (id === VISUALIZER_OFF) return setEnabled(profile, false);
      if (!ids.has(id)) return;
      const turnedOn = !enabled(profile) && write(switches, switchKey(profile), profile, 'on');
      const changed = write(scenesSaved, sceneKey(profile), profile, id);
      if (turnedOn || changed) notify();
    },
    enabled,
    setEnabled,
  };
}

/** What Now Playing draws for a music item. `capable`: the device and this item can visualize at
 * all. Off draws the artwork backdrop: no stage (so no renderer, GPU work or audio analysis) and no
 * full-screen entry, but the On/Off switch stays so the viewer can turn it back on. */
export function visualizerPlan(capable: boolean, on: boolean, expanded: boolean) {
  const stage = capable && on;
  return {
    stage: stage ? (expanded ? 'fullscreen' as const : 'background' as const) : null,
    switch: capable,
  };
}

export function adjacentScene(id: string, direction: -1 | 1): string {
  const index = Math.max(0, scenes.findIndex(scene => scene.id === id));
  return scenes[(index + scenes.length + direction) % scenes.length]!.id;
}
