// Where a Sports page starts under the active document's shell.
import { hasFlowHeader, overlayHeaderOffset } from '../../resolve/inherit';
import type { Node } from '../../../../protocol/skin';

/** How far below the top a page starts when the shell's navigation floats over it (as inherited
 * library pages start): the bar's declared height, else none for a shell whose header is in flow. */
export function barOffset(shell: Node | undefined, small: boolean, insetTop: number): number {
  if (!shell || hasFlowHeader(shell)) return 0;
  const offset = overlayHeaderOffset(shell);
  const text = small ? offset.small : offset.wide;
  const px = Number(/(-?\d+(?:\.\d+)?)px/.exec(text)?.[1] ?? 0);
  return px + (text.includes('safe-area-inset-top') ? insetTop : 0);
}

