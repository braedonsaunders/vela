// Which downloads port a web bundle uses: a desktop shell's (it stores files in the app's data
// folder and its native player opens them), else the browser's own storage.
import type { DownloadsPort } from '@vela/core';
import { browserDownloads } from './downloads-browser';
import { desktopDownloadsBridge, shellDownloads } from './downloads-shell';

export function webDownloads(): DownloadsPort | undefined {
  const bridge = desktopDownloadsBridge();
  return bridge ? shellDownloads(bridge) : browserDownloads();
}
