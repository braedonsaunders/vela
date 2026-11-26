// What the host app supplies to the store: where the default server is, how secrets are kept,
// what this device is and what it can play. Everything platform-specific stays on the app side.
import type { SecretStore } from '../session';
import type { ClientCapabilities } from '../wire';
import type { DownloadsPort } from './downloads';

/** The media a client declares: what the player on this platform can demux, decode and present. */
export type MediaCapabilities = Pick<
  ClientCapabilities,
  'containers' | 'videoCodecs' | 'audioCodecs' | 'subtitleFormats' | 'hls' | 'mse' | 'hdr' | 'maxWidth' | 'maxHeight' | 'originalPlayback'
  | 'dolbyVisionProfiles' | 'dolbyVisionReshape' | 'audioOutput'
>;

export interface VelaPlatform {
  /** The Ether server the app belongs to: the serving page's origin when Ether hosts the web app,
   * the configured one natively. Absent in a standalone app (the desktop apps), where every server,
   * Ether included, is one the viewer adds. */
  etherOrigin?: string;
  /** Sessions, server tokens and the device ID: Keychain or Keystore natively, page storage on the web. */
  secrets: SecretStore;
  /** This device as servers list it ("Apple TV", "tvos"). */
  device: { name: string; platform: string };
  appVersion: string;
  /** What the player plays (`VelaPlayer.capabilities()`); sign-in does not wait for it. */
  media: MediaCapabilities | Promise<MediaCapabilities>;
  /** What the app's audio engine plays (`VelaPlayer.audioCapabilities()`): music, audiobooks and
   * podcasts are declared with this, never with the video player's list (a desktop's native video host
   * decodes far less audio than the page's own engine that plays them). Absent, or failing: `media`. */
  audio?: MediaCapabilities | Promise<MediaCapabilities>;
  /** Offline original-file downloads and their native index/outbox (iPhone and iPad). */
  downloads?: DownloadsPort;
  /** The web page the app is served from. Absent natively, where there is no page to hand a session to. */
  page?: {
    origin: string;
    /** A sign-in link's captured #code, redeemed once at start. */
    webCode?: string;
    /** A validated same-host HTTP(S) console URL, when the page was opened by Ether. */
    consoleUrl?: string;
  };
  /** Start an account-authorization window from the viewer's press, before network work loses
   * the browser's user gesture. Browser and desktop hosts provide this; TVs and native apps do not. */
  beginExternalAuth?(): { navigate(url: string): void; close(): void };
  /** Development against mock-server: the Ether server signs in as its demo viewer. */
  mock?: boolean;
  /** The width artwork is sized for, in pixels (the display's longer side times its scale). */
  artWidth: number;
}

/** A secure page cannot reach plain-HTTP servers, so it never offers or adds one. */
export function pageSecure(platform: VelaPlatform): boolean {
  return platform.page?.origin.startsWith('https:') ?? false;
}
