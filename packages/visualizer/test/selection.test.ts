import { expect, test } from 'bun:test';
import { adjacentScene, scenes, sceneSelection, VISUALIZER_OFF, visualizerPlan, visualizerProfile } from '../../../apps/vela/src/visualizer/selection';

test('selection belongs to a profile on one server and survives reopening', () => {
  const values = new Map<string, string>();
  const storage = { get: (key: string) => values.get(key) ?? null, set: (key: string, id: string) => { values.set(key, id); } };
  const settings = sceneSelection(storage);
  const first = visualizerProfile('one', 'viewer');
  const second = visualizerProfile('two', 'viewer');
  let updates = 0;
  const remove = settings.subscribe(() => updates++);
  expect(settings.get(first, 'incense')).toBe('incense');
  settings.set(first, 'leaves');
  settings.set(first, 'unknown');
  expect(sceneSelection(storage).get(first, 'incense')).toBe('leaves');
  expect(settings.get(second, 'incense')).toBe('incense');
  expect(settings.get(visualizerProfile('one', 'another'), 'incense')).toBe('incense');
  expect(updates).toBe(1);
  remove();
  settings.set(first, 'incense');
  expect(updates).toBe(1);
});
test.each(['contour', 'forest'])('retired %s falls back to the document default or first scene; remote changes wrap', retired => {
  const settings = sceneSelection({ get: () => retired, set() {} });
  expect(settings.get('profile', 'leaves')).toBe('leaves');
  expect(settings.get('profile', 'missing')).toBe(scenes[0]!.id);
  expect(adjacentScene(scenes[0]!.id, -1)).toBe(scenes.at(-1)!.id);
  expect(adjacentScene(scenes.at(-1)!.id, 1)).toBe(scenes[0]!.id);
});

function memory() {
  const values = new Map<string, string>();
  return { values, get: (key: string) => values.get(key) ?? null, set: (key: string, value: string) => { values.set(key, value); } };
}

test('the visualizer is on by default and Off belongs to one profile on this device', () => {
  const storage = memory();
  const settings = sceneSelection(storage);
  const mine = visualizerProfile('one', 'viewer');
  const theirs = visualizerProfile('one', 'another');
  expect(settings.enabled(mine)).toBe(true);
  expect(storage.values.size).toBe(0); // Reading writes nothing.
  settings.setEnabled(mine, false);
  expect(settings.enabled(mine)).toBe(false);
  expect(settings.enabled(theirs)).toBe(true);
  expect(settings.enabled(visualizerProfile('two', 'viewer'))).toBe(true);
  // Reopening the app reads it back.
  expect(sceneSelection(storage).enabled(mine)).toBe(false);
  settings.setEnabled(mine, true);
  expect(sceneSelection(storage).enabled(mine)).toBe(true);
});

test('Off keeps the scene: turning it on, or choosing a scene, resumes', () => {
  const storage = memory();
  const settings = sceneSelection(storage);
  const profile = visualizerProfile('one', 'viewer');
  let updates = 0;
  settings.subscribe(() => updates++);
  settings.set(profile, 'leaves');
  settings.set(profile, VISUALIZER_OFF);
  expect(settings.enabled(profile)).toBe(false);
  expect(settings.get(profile, 'incense')).toBe('leaves');
  expect(updates).toBe(2);
  settings.set(profile, VISUALIZER_OFF);
  expect(updates).toBe(2);
  // Choosing the scene already chosen still turns it back on.
  settings.set(profile, 'leaves');
  expect(settings.enabled(profile)).toBe(true);
  expect(updates).toBe(3);
  settings.setEnabled(profile, false);
  settings.setEnabled(profile, true);
  expect(sceneSelection(storage).get(profile, 'incense')).toBe('leaves');
  // An unknown scene changes nothing.
  settings.setEnabled(profile, false);
  settings.set(profile, 'unknown');
  expect(settings.enabled(profile)).toBe(false);
});

test('unreadable or unwritable storage leaves the visualizer on, and Off holds for the session', () => {
  const settings = sceneSelection({ get() { throw new Error('locked'); }, set() { throw new Error('locked'); } });
  expect(settings.enabled('profile')).toBe(true);
  settings.setEnabled('profile', false);
  expect(settings.enabled('profile')).toBe(false);
  // An unexpected stored value reads as on.
  expect(sceneSelection({ get: () => 'maybe', set() {} }).enabled('profile')).toBe(true);
});

test('Off means no stage (no renderer, GPU or analysis) but keeps the switch; an incapable device offers neither', () => {
  expect(visualizerPlan(true, true, false)).toEqual({ stage: 'background', switch: true });
  expect(visualizerPlan(true, true, true)).toEqual({ stage: 'fullscreen', switch: true });
  expect(visualizerPlan(true, false, false)).toEqual({ stage: null, switch: true });
  expect(visualizerPlan(true, false, true)).toEqual({ stage: null, switch: true });
  expect(visualizerPlan(false, true, true)).toEqual({ stage: null, switch: false });
});

test('browser Back from the visualizer preserves the router entry and avoids duplicate opens', async () => {
  const { inVisualizerHistory, pushVisualizerHistory, popVisualizerHistory } = await import('../../../apps/vela/src/visualizer/page-history');
  const entries: Record<string, unknown>[] = [{ id: 'title-page' }];
  const history = {
    get state() { return entries.at(-1); },
    pushState(state: Record<string, unknown>) { entries.push(state); },
    back() { entries.pop(); },
  };
  pushVisualizerHistory(history);
  pushVisualizerHistory(history);
  expect(inVisualizerHistory(history)).toBe(true);
  expect(entries.length).toBe(2);
  expect(history.state?.id).toBe('title-page');
  popVisualizerHistory(history);
  popVisualizerHistory(history);
  expect(entries).toEqual([{ id: 'title-page' }]);
});
