// A browser's downloads (docs/downloads.md): the Origin Private File System once storage is
// persistent, and Save file otherwise. Implemented by the web downloads slice.
import type { DownloadsPort } from '@vela/core';

/** The OPFS port where the browser has it; undefined where it cannot hold files at all. */
export function browserDownloads(): DownloadsPort | undefined {
  return undefined;
}
