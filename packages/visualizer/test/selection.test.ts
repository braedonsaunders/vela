import { expect, test } from 'bun:test';
import { adjacentScene, scenes, sceneSelection, visualizerProfile } from '../../../apps/vela/src/visualizer/selection';

test('selection belongs to a profile on one server and survives reopening', () => {
  const values = new Map<string, string>();
  const storage = { get: (key: string) => values.get(key) ?? null, set: (key: string, id: string) => { values.set(key, id); } };
  const settings = sceneSelection(storage);
  const first = visualizerProfile('one', 'viewer');
  const second = visualizerProfile('two', 'viewer');
  let updates = 0;
  const remove = settings.subscribe(() => updates++);
  expect(settings.get(first, 'ink')).toBe('ink');
  settings.set(first, 'leaves');
  settings.set(first, 'unknown');
  expect(sceneSelection(storage).get(first, 'ink')).toBe('leaves');
  expect(settings.get(second, 'ink')).toBe('ink');
  expect(settings.get(visualizerProfile('one', 'another'), 'ink')).toBe('ink');
  expect(updates).toBe(1);
  remove();
  settings.set(first, 'ink');
  expect(updates).toBe(1);
});
test('retired IDs fall back to the document default or first scene; remote changes wrap', () => {
  const settings = sceneSelection({ get: () => 'retired', set() {} });
  expect(settings.get('profile', 'leaves')).toBe('leaves');
  expect(settings.get('profile', 'missing')).toBe(scenes[0]!.id);
  expect(adjacentScene(scenes[0]!.id, -1)).toBe(scenes.at(-1)!.id);
  expect(adjacentScene(scenes.at(-1)!.id, 1)).toBe(scenes[0]!.id);
});

test('browser Back from the visualizer preserves the router entry and avoids duplicate opens', async () => {
  const { inVisualizerHistory, pushVisualizerHistory, popVisualizerHistory } = await import('../../../apps/vela/src/visualizer/page-history');
  const entries: unknown[] = [{ id: 'title-page' }];
  const history = {
    get state() { return entries.at(-1); },
    pushState(state: unknown) { entries.push(state); },
    back() { entries.pop(); },
  } as History;
  pushVisualizerHistory(history);
  pushVisualizerHistory(history);
  expect(inVisualizerHistory(history)).toBe(true);
  expect(entries.length).toBe(2);
  expect(history.state.id).toBe('title-page');
  popVisualizerHistory(history);
  popVisualizerHistory(history);
  expect(entries).toEqual([{ id: 'title-page' }]);
});
