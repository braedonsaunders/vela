import { preferences } from '../data/preferences';
import { sceneSelection } from './selection';

const choice = sceneSelection(preferences);
export const getVisualizerScene = choice.get;
export const setVisualizerScene = choice.set;
export const subscribeVisualizerScene = choice.subscribe;
