// Whether this page can play a playback path at all, before asking the server for it: the quality
// menu marks a path it cannot play (Original quality on a plain-http page, which has no WebCodecs,
// or a Matroska/HEVC file the browser's own player does not take), and a switch to one is refused
// with the reason rather than accepted and forgotten.

/** Why a path cannot play on this page: the original-file route needs a secure page (WebGPU and
 * WebCodecs exist only there), or this browser has no player for the file at all. */
export type Unplayable = 'insecure-page' | 'browser';

export interface PageAbility {
  /** The page is a secure context (https, or localhost). */
  secure: boolean;
  /** The core's original-file route can run here (canAttemptOriginal). */
  originalRoute: boolean;
  /** The browser's own media element plays this type. */
  canPlay(mime: string): boolean;
}

/** A file path's playability. HLS paths are judged at activation, from their renditions; a path
 * without a known type is taken as playable (the engine finds out when it plays). */
export function pathUnplayable(path: { delivery?: 'file' | 'hls'; mime?: string; original?: boolean }, page: PageAbility): Unplayable | null {
  if (path.delivery !== 'file' || !path.mime) return null;
  if (path.original && page.originalRoute) return null;
  if (page.canPlay(path.mime)) return null;
  return path.original && !page.secure ? 'insecure-page' : 'browser';
}

/** The refusal a switch to an unplayable path answers with (the engine has no translations; the
 * menu shows its own words for the same reasons before anyone chooses). */
export function unplayableMessage(reason: Unplayable): string {
  return reason === 'insecure-page'
    ? "This page can't play the original file; open Vela over https or in the app"
    : "This browser can't play this file; choose a converted quality or open Vela in the app";
}
