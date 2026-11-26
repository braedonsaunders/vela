// Web builds do not store background original-file downloads.
import type { VelaDownloadsPort } from './downloads';

export type {
  NativeDownloadSidecar,
  NativeDownloadTransferProgress,
  NativeDownloadTransferRequest,
  NativeDownloadsSnapshot,
  VelaDownloadsPort,
} from './downloads';

export const velaDownloads: VelaDownloadsPort | undefined = undefined;
