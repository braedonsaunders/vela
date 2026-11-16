import type { BoxNode, Node } from '../../../wire/v0/skin';

// Compiled's pill buttons (PrimaryPill, GhostPill) shrink to .97 while pressed and its round
// icon buttons (IconButton) to .94; links, chips, tabs and dots keep their size.
export const pressScale = (node: BoxNode): string | undefined => {
  const st = node.style ?? {};
  if (st['border-radius'] !== '999px') return undefined;
  if (st.width && st.width === st.height) return '0.94';
  return parseFloat(st.height ?? '0') >= 42 ? '0.97' : undefined;
};
// Compiled controls keep the platform focus ring beside their own :focus-visible shadow
// unless they set outline themselves, so a focus overlay keeps it too.
export const keepRing = (node: Node): void => {
  if (node.type === 'box' || node.type === 'widget') {
    const f = (node as BoxNode).focus;
    if (f && f.outline === undefined) (node as BoxNode).focus = { ...f, outline: 'auto' };
  }
};
// Per press node: compiled's ring and press scale (an authored hover already replaces the
// platform hover wash; the pressed look still applies).
export const compiledControl = (node: Node): void => {
  keepRing(node);
  if (node.type === 'box' && node.press && !node.active) {
    const scale = pressScale(node);
    if (scale) node.active = { scale };
  }
  if ('children' in node) node.children?.forEach(compiledControl);
  if (node.type === 'repeat') compiledControl(node.item);
};
