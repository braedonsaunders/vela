// On web, the visualizer is a page inside the existing Now Playing overlay. A
// same-address entry lets the browser close it while retaining the router's ID,
// the underlying title page and the transport that opened it.
const marker = 'velaMusicVisualizer';
export function inVisualizerHistory(history: History): boolean {
  return history.state?.[marker] === true;
}
export function pushVisualizerHistory(history: History) {
  if (!inVisualizerHistory(history)) history.pushState({ ...history.state, [marker]: true }, '');
}
export function popVisualizerHistory(history: History) {
  if (inVisualizerHistory(history)) history.back();
}
