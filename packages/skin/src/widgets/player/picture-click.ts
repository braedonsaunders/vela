// What a mouse click on the picture does (the web page and the desktop apps, chrome.tsx). One click
// plays or pauses at once, as in every desktop player; a second within the double-click window makes
// it a double click, which changes full screen and leaves playback as it was before the first.

/** A second click within this many milliseconds of the first is a double click. */
export const DOUBLE_CLICK_MS = 300;
/**
 * How long a double click's undo waits behind its full-screen command. The player view takes one
 * command a render, and the web host reads a command only after it has refreshed media access, so
 * an undo sent in the very next render could replace full screen before the host has taken it.
 */
export const UNDO_AFTER_MS = 250;

export type PlayCommand = 'play' | 'pause';

/** The last single click: when it came, and the command that puts back what it changed. */
export interface ClickMemory {
  at: number;
  undo: PlayCommand | null;
}

export const NO_CLICK: ClickMemory = { at: Number.NEGATIVE_INFINITY, undo: null };

export interface PictureClick {
  now: number;
  /** Whether the picture plays now, as the viewer will see it (a pending undo already counted). */
  playing: boolean;
  /** A plan to command and an end not yet reached: a click may play or pause. */
  canToggle: boolean;
  /** The view can go full screen. */
  fullscreen: boolean;
}

export interface ClickOutcome {
  memory: ClickMemory;
  /** Sent with this click. */
  now: PlayCommand | 'fullscreen' | null;
  /** Sent UNDO_AFTER_MS later, unless a later click or play command takes its place. */
  later: PlayCommand | null;
}

/**
 * A double click undoes its first click's toggle with the command recorded when that click was sent,
 * never by toggling again from the view's playing state, which a host may not have reported yet.
 * Full screen goes out with the second click (a browser grants it only to a click), the undo after
 * it; without full screen the undo goes at once.
 */
export function pictureClick(last: ClickMemory, click: PictureClick): ClickOutcome {
  if (click.now - last.at < DOUBLE_CLICK_MS) {
    if (!click.fullscreen) return { memory: NO_CLICK, now: last.undo, later: null };
    return { memory: NO_CLICK, now: 'fullscreen', later: last.undo };
  }
  const toggle: PlayCommand | null = click.canToggle ? (click.playing ? 'pause' : 'play') : null;
  return {
    memory: { at: click.now, undo: toggle === 'pause' ? 'play' : toggle === 'play' ? 'pause' : null },
    now: toggle,
    later: null,
  };
}
