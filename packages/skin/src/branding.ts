import type { Branding } from '../../protocol/types';
/** Apply owner identity to built-in lockups after inheritance, including custom shell slots. */
export function brandDocument<T>(document: T, branding: Branding | undefined, background?: string): T {
  if (!branding) return document;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const node = value as Record<string, unknown>;
    if (node.type === 'box' && Array.isArray(node.children) && node.children.some(child => child?.type === 'image' && /\/vela-mark\.svg$/.test(child.src))) {
      return visit({...node, children: [{type: 'image', src: 'assets/brand/vela-lockup.svg'}]});
    }
    if (node.type === 'image' && typeof node.src === 'string' && /assets\/brand\/vela-(lockup|stacked)/.test(node.src)) {
      const { src, alt, small, ...rest } = node;
      return branding.wordmark
        ? { ...rest, type: 'image', src: brandingWordmark(branding, background), alt: branding.name || '', style: { ...(node.style as object), width: `${Math.min(200, 36 * branding.wordmark.width / branding.wordmark.height)}px`, height: '36px', 'object-fit': 'contain' }, small: { width: '110px', height: '30px' } }
        : { ...rest, type: 'text', text: branding.name, style: { 'font-size': '24px', 'font-weight': '700' } };
    }
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)]));
  };
  return visit(document) as T;
}

export function brandingWordmark(branding: Branding | undefined, background = '#090b0e'): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(background)?.[1];
  const dark = !hex || (parseInt(hex.slice(0, 2), 16) * 0.299 + parseInt(hex.slice(2, 4), 16) * 0.587 + parseInt(hex.slice(4, 6), 16) * 0.114) < 128;
  return (dark ? branding?.wordmark?.dark : '') || branding?.wordmark?.url || '';
}
