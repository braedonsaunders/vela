import type { Node } from '../../protocol/skin';
import type { Viewport } from './css';
import { hasFlowHeader, overlayHeaderOffset } from './resolve/inherit';

function headerPixels(value: string, viewport: Viewport): number | undefined {
  const px = /(-?\d+(?:\.\d+)?)px/.exec(value);
  if (!px) return undefined;
  return Number(px[1]) + (value.includes('env(safe-area-inset-top') ? viewport.insets.top : 0);
}

/** The visible bottom edge of an overlay navigation. Some skins put the height on an inner
 * bezel and inset the navigation itself, rather than declaring a height on the role node. */
function overlayNavigationBottom(shell: Node | undefined, small: boolean, viewport: Viewport): number | undefined {
  let bottom: number | undefined;
  const walk = (node: Node) => {
    if (bottom !== undefined || node.type !== 'box') return;
    const style = { ...node.style, ...(small ? node.small : node.wide) };
    if (node.role === 'navigation' && style.position === 'absolute') {
      const top = typeof style.top === 'string' ? headerPixels(style.top, viewport) : 0;
      let height = typeof style.height === 'string' ? headerPixels(style.height, viewport) : undefined;
      if (height === undefined) {
        for (const child of node.children ?? []) {
          if (child.type !== 'box') continue;
          const childStyle = { ...child.style, ...(small ? child.small : child.wide) };
          if (typeof childStyle.height === 'string') height = Math.max(height ?? 0, headerPixels(childStyle.height, viewport) ?? 0);
        }
      }
      if (top !== undefined && height !== undefined) bottom = top + height;
    }
    for (const child of node.children ?? []) walk(child);
  };
  if (shell) walk(shell);
  return bottom;
}

/** Pin the search field itself immediately below an overlay header. The authored slot includes
 * padding around the field, so its sticky box starts that padding distance above the bar edge. */
export function searchStickyTop(shell: Node | undefined, small: boolean, viewport: Viewport, paddingTop: number): number {
  if (hasFlowHeader(shell)) return -paddingTop;
  const navigationBottom = overlayNavigationBottom(shell, small, viewport);
  if (navigationBottom !== undefined) return navigationBottom - paddingTop;
  const offset = overlayHeaderOffset(shell);
  const header = headerPixels(small ? offset.small : offset.wide, viewport) ?? 56 + viewport.insets.top;
  return header - paddingTop;
}
