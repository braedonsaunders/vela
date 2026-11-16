// What the host app supplies to the store: where the default server is, how secrets are kept,
// what this device is and what it can play. Everything platform-specific stays on the app side.
import type { SecretStore } from '../session';
import type { ClientCapabilities } from '../wire';

/** The media a client declares: what the player on this platform can demux, decode and present. */
export type MediaCapabilities = Pick<
  ClientCapabilities,
  'containers' | 'videoCodecs' | 'audioCodecs' | 'subtitleFormats' | 'hls' | 'mse' | 'originalPlayback'
>;

export interface VelaPlatform {
  /** The Ether server the app belongs to: the serving page's origin on the web, the configured one natively. */
  etherOrigin: string;
  /** Sessions, server tokens and the device ID: Keychain or Keystore natively, page storage on the web. */
  secrets: SecretStore;
  /** This device as servers list it ("Apple TV", "tvos"). */
  device: { name: string; platform: string };
  appVersion: string;
  media: MediaCapabilities;
  /** The web page the app is served from. Absent natively, where there is no page to hand a session to. */
  page?: {
    origin: string;
    /** A sign-in link's one-time code (`#code=` or `?code=`), redeemed once at start. */
    webCode?: string;
  };
  /** Development against mock-server: the Ether server signs in as its demo viewer. */
  mock?: boolean;
  /** The width artwork is sized for, in pixels (the display's longer side times its scale). */
  artWidth: number;
}

/** A secure page cannot reach plain-HTTP servers, so it never offers or adds one. */
export function pageSecure(platform: VelaPlatform): boolean {
  return platform.page?.origin.startsWith('https:') ?? false;
}
