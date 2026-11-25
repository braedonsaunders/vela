// On web, the visualizer is a page inside the existing Now Playing overlay. A
// same-address entry lets the browser close it while retaining the router's ID,
// the underlying title page and the transport that opened it.
const marker = 'velaMusicVisualizer';
type VisualizerHistory = Pick<History, 'state' | 'pushState' | 'back'>;
export function inVisualizerHistory(history: VisualizerHistory): boolean {
  return history.state?.[marker] === true;
}
export function pushVisualizerHistory(history: VisualizerHistory) {
  if (!inVisualizerHistory(history)) history.pushState({ ...history.state, [marker]: true }, '');
}
export function popVisualizerHistory(history: VisualizerHistory) {
  if (inVisualizerHistory(history)) history.back();
}
