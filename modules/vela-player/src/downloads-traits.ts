// Which devices store downloads and what their engines can do (packages/core DownloadsTraits).
// Kept free of React Native so the rules are testable on their own.

/** packages/core DownloadsTraits, as this module declares them. */
export interface NativeDownloadsTraits {
  engine: 'background' | 'service';
  metered: boolean;
  reserveBytes: number;
  reveal: false;
  export: false;
  minimumFreeToOffer: number | null;
  saveFile: null;
}

/** Devices and desktops keep 2 GB free after every queued transfer. */
const RESERVE_BYTES = 2_000_000_000;
/** Android TV offers Download only while it could still hold a typical film (4 GB) above the reserve. */
export const ANDROID_TV_MINIMUM_FREE_TO_OFFER = RESERVE_BYTES + 4_000_000_000;

export function nativeDownloadsTraits(os: string, tv: boolean): NativeDownloadsTraits {
  return {
    engine: os === 'android' ? 'service' : 'background',
    // A TV has no mobile data: the Wi-Fi-only setting means nothing there.
    metered: !(os === 'android' && tv),
    reserveBytes: RESERVE_BYTES,
    reveal: false,
    export: false,
    minimumFreeToOffer: os === 'android' && tv ? ANDROID_TV_MINIMUM_FREE_TO_OFFER : null,
    saveFile: null,
  };
}

/** Whether this device stores downloads: iPhone, iPad and Android (phone, tablet, TV); never tvOS. */
export function nativeDownloadsSupported(os: string, tv: boolean): boolean {
  return (os === 'ios' && !tv) || os === 'android';
}
