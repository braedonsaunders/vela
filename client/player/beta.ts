/** Device-local preference. Enabling affects subsequent session negotiation. */
const key = 'vela.player.beta';
const changed = 'vela:player-beta';
let volatile: boolean | null = null;
export function betaPlayerEnabled(): boolean {
  if (volatile !== null) return volatile;
  try { return localStorage.getItem(key) === 'true'; } catch { return false; }
}
export function setBetaPlayer(enabled: boolean) {
  const previous = betaPlayerEnabled(); volatile = enabled;
  try { localStorage.setItem(key, String(enabled)); } catch { /* Retain this page's choice when storage is unavailable. */ }
  if (previous !== enabled) window.dispatchEvent(new Event(changed));
}
export function subscribeBetaPlayer(listener: () => void): () => void {
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) { volatile = null; listener(); } };
  window.addEventListener(changed, listener); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(changed,listener); window.removeEventListener('storage',storage); };
}
