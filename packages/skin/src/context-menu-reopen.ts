// A right-click while one of Vela's card menus is open (web). The menu's backdrop covers the page,
// so the browser saw the right-click land on the backdrop and opened its own menu there. Instead
// the right-click goes to what lies under the pointer, as if the menu had not been open:
//
// - On a card, track row or tile with a Vela menu: the open menu closes and that one opens at the
//   new pointer position (its own contextmenu handler claims the event).
// - On a text field, a link or selected text: the open menu closes and the browser's menu opens,
//   with Copy, Paste and Open link, as anywhere else in Vela.
// - Anywhere else (empty space, a heading, a picture): the right-click only closes the open menu;
//   the browser's menu is held back, so one click never leaves a second menu in place of ours.
// - Over the open menu itself: nothing closes, and the browser's menu never opens.

/** A press that opens a context menu: the secondary button, or Control-click on a Mac. */
export function isMenuPress(event: { button: number; ctrlKey: boolean }, mac: boolean): boolean {
  return event.button === 2 || (mac && event.button === 0 && event.ctrlKey);
}

/** What lies under a right-click that closed an open menu, once the page has handled it. */
export interface RightClickTarget {
  /** A Vela handler opened its own menu (it prevented the browser's). */
  claimed: boolean;
  /** An input, a text area or editable content. */
  editable: boolean;
  /** Inside a link with an address. */
  link: boolean;
  /** Text is selected on the page. */
  selection: boolean;
}

/** Who answers that right-click: Vela's menu there, the browser's menu, or nobody. */
export function rightClickAnswer(target: RightClickTarget): 'vela' | 'browser' | 'none' {
  if (target.claimed) return 'vela';
  if (target.editable || target.link || target.selection) return 'browser';
  return 'none';
}

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

function describe(event: MouseEvent): RightClickTarget {
  const element = event.target instanceof Element ? event.target : null;
  return {
    claimed: event.defaultPrevented,
    editable: !!element?.closest(EDITABLE),
    link: !!element?.closest('a[href]'),
    selection: !!document.getSelection()?.toString(),
  };
}

/**
 * Called on the press that closes an open menu: the menu's layers stop taking the pointer (so the
 * coming contextmenu lands on the page beneath), and that contextmenu, after the page's own
 * handlers, keeps the browser's menu only where `rightClickAnswer` says so.
 */
export function passRightClickThrough(menuLayer: HTMLElement | null): void {
  const held: [HTMLElement, string][] = [];
  for (let node: HTMLElement | null = menuLayer; node && node !== document.body; node = node.parentElement) {
    held.push([node, node.style.pointerEvents]);
    node.style.pointerEvents = 'none';
  }
  // The layers are on their way out; should one stay (the next menu drawn in the same place), it
  // takes the pointer again once the right-click has been answered.
  const restore = () => { for (const [node, value] of held) node.style.pointerEvents = value; };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = (event: MouseEvent) => {
    clearTimeout(timer);
    restore();
    if (rightClickAnswer(describe(event)) === 'none') event.preventDefault();
  };
  // Bubbling on the window: after React's root listener, so a card's handler has had its turn.
  window.addEventListener('contextmenu', settle, { once: true });
  // Windows sends contextmenu on release; a press that never becomes one leaves nothing behind.
  timer = setTimeout(() => { window.removeEventListener('contextmenu', settle); restore(); }, 2000);
}

export const macPlatform = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
