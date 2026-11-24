// What the import results say when the source shared only part of its playlist.
import { msg, number, type PlaylistImportModel } from '@vela/core';

/** The shared count, and the playlist's real size when the source gave it. */
export function importTruncatedNote(job: Pick<PlaylistImportModel, 'total' | 'sourceTotal'>): string {
  return typeof job.sourceTotal === 'number' && job.sourceTotal > job.total
    ? msg('music.import.truncatedOf', { shared: number(job.total), total: number(job.sourceTotal) })
    : msg('music.import.truncated', { shared: number(job.total) });
}
