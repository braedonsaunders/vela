// Pure shell header offset calculation (`barOffset`), usable in node/bun tests without importing `react-native`.
import type { Node } from '../../../protocol/skin';
import { hasFlowHeader, overlayHeaderOffset } from '../resolve/inherit';

/** How far below the top a page starts when the shell's navigation floats over it (as inherited
 * library pages start): the bar's declared height, else none for a shell whose header is in flow. */
export function barOffset(shell: Node | undefined, small: boolean, insetTop: number): number {
  if (!shell || hasFlowHeader(shell)) return 0;
  const offset = overlayHeaderOffset(shell);
  const text = small ? offset.small : offset.wide;
  const px = Number(/(-?\d+(?:\.\d+)?)px/.exec(text)?.[1] ?? 0);
  return px + (text.includes('safe-area-inset-top') ? insetTop : 0);
}
