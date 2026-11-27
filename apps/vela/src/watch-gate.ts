import { isPlayableDownload, type AuthPhase, type DownloadRecord } from '@vela/core';

/**
 * Whether /watch/:id may draw its player. Signed in, always. Otherwise only a plain title
 * (no `kind`) with a verified download: offline, or signed out after the server refused the
 * session while that viewer's download waits for them to sign in again (docs/downloads.md).
 */
export function watchAllowed(phase: AuthPhase, hydrated: boolean, kind: string | undefined, record: DownloadRecord | undefined): boolean {
  if (phase === 'signed-in') return true;
  if (!hydrated || kind || !isPlayableDownload(record)) return false;
  return phase === 'offline' || (phase === 'signed-out' && record?.awaitingSignIn === true);
}
