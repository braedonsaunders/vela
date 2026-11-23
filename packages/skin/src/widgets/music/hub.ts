// Open full-screen Now Playing from anywhere (the bar's expand and lyrics buttons): the audio dock
// that owns it listens. `panel` picks the side it opens on.
export type NowPlayingPanel = 'queue' | 'lyrics';
type Listener = (panel: NowPlayingPanel | undefined) => void;
const listeners = new Set<Listener>();

export function openNowPlaying(panel?: NowPlayingPanel): void { for (const l of [...listeners]) l(panel); }
export function onOpenNowPlaying(listener: Listener): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
