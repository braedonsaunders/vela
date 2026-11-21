// The title and person pages' modal motion on the web. Opening, the scrim dissolves in while the
// frame rises with the document's velaOpen; closing is the same gesture reversed and quicker: the
// frame settles back and fades as the scrim lifts, and only then does the route leave. Native hosts
// get both from the navigator's own transition (a transparent modal that fades), so this is web only.
// Under reduced motion every state is instant.
import { Platform } from 'react-native';

/** The modal's testID: the scrimmed route view DocumentScreen draws for title and person pages. */
export const MODAL_TEST_ID = 'detail-modal';
/** The scrim's dissolve in, matching the section slide. */
export const MODAL_ENTER_MS = 260;
/** Closing is quicker than opening: the viewer has already decided. */
export const MODAL_EXIT_MS = 220;
/** The opening rise's easing (velaOpen) reversed into an ease-in for the exit. */
export const MODAL_EXIT_EASING = 'cubic-bezier(0.4, 0, 1, 1)';
/** Where the frame settles to as it leaves: a little lower and smaller, as velaOpen starts. */
export const MODAL_EXIT_FRAME = 'translateY(18px) scale(0.965)';

export const MODAL_ENTER_KEYFRAMES = { from: { opacity: 0 }, to: { opacity: 1 } };

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const closing = new WeakSet<Element>();

/** The modal on top: the last one drawn that is not covered. */
function topModal(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined;
  const modals = Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${MODAL_TEST_ID}"]`))
    .filter(element => !element.closest('[aria-hidden="true"]') && element.getBoundingClientRect().width > 0);
  return modals[modals.length - 1];
}

/** Close the modal on top with its exit motion, then `leave` (the navigation). A second close while
 * one is leaving is ignored, so a double click or Escape during the motion never pops twice. */
export function closeModal(leave: () => void): void {
  if (Platform.OS !== 'web') { leave(); return; }
  const modal = topModal();
  if (!modal || prefersReducedMotion() || typeof modal.animate !== 'function') { leave(); return; }
  if (closing.has(modal)) return;
  closing.add(modal);
  modal.style.pointerEvents = 'none';
  const frame = modal.querySelector<HTMLElement>('[data-testid="detail-frame"]');
  const timing: KeyframeAnimationOptions = { duration: MODAL_EXIT_MS, easing: MODAL_EXIT_EASING, fill: 'forwards' };
  const fade = modal.animate([{ opacity: 1 }, { opacity: 0 }], timing);
  // From wherever the opening rise has got to: a close during it never jumps.
  const settle = frame?.animate([{ transform: getComputedStyle(frame).transform }, { transform: MODAL_EXIT_FRAME }], timing);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    leave();
    // A route that stays (a replace onto the same page) must not stay invisible.
    setTimeout(() => {
      if (!modal.isConnected) return;
      fade.cancel(); settle?.cancel();
      modal.style.pointerEvents = '';
      closing.delete(modal);
    }, 400);
  };
  fade.onfinish = finish;
  // A background tab throttles animation frames; never let the close wait on them.
  setTimeout(finish, MODAL_EXIT_MS + 120);
}
