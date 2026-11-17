import type { Node } from './skin';

/** Shared authoring contract: one ordered, full-row play target per episode. Skins keep
 * their artwork and typography, but never embed competing detail/play buttons in a row. */
export function episodePage(root: Node, templates: Record<string, Node> = {}): Node {
  const strip = (n: Node): Node => {
    if (n.type === 'use') return templates[n.template] ? strip(templates[n.template]!) : { type: 'box' };
    if (n.type !== 'box') return n;
    const { press, id, testId, ...rest } = n;
    return { ...rest, children: n.children?.map(strip) };
  };
  const contains = (n: Node): boolean => n.type === 'repeat' ? n.over === 'detail.episodes' : n.type === 'box' && !!n.children?.some(contains);
  const walk = (n: Node): Node => {
    if (n.type === 'repeat') {
      if (n.over === 'detail.upNext') return { type: 'box' };
      if (n.over !== 'detail.episodes') return { ...n, item: walk(n.item) };
      const source = n.item.type === 'use' ? templates[n.item.template] ?? n.item : n.item;
      const item = strip(source);
      if (item.type !== 'box') throw new Error('Episode rows must be boxes');
      return { ...n, item: { ...item, motion: undefined, stagger: undefined, id: 'episode-{card.id}', testId: 'episode-{card.id}', group: true,
        style: { ...item.style, display: 'flex', 'flex-direction': 'row', width: '100%', gap: '20px', 'align-items': 'center', 'padding-left': '16px', 'padding-right': '16px' }, small: { ...item.small, width: '100%', 'flex-direction': 'row', 'padding-left': '12px', 'padding-right': '12px' },
        children: item.children?.map(c => c.type === 'box' && (c.style?.['aspect-ratio'] || c.style?.width === '100%') ? { ...c, style: { ...c.style, width: '220px', 'flex-shrink': '0' }, small: { ...c.small, width: '128px' } } : c),
        press: { action: 'play', arg: '{card.id}' }, label: '{episode.playLabel}: {episode.numberTitle}',
        focus: { ...item.focus, 'box-shadow': '0px 0px 0px 3px $ui.accent', translate: '0px -2px' },
      } };
    }
    if (n.type !== 'box') return n;
    const list = n.children?.some(c => c.type === 'repeat' && c.over === 'detail.episodes') || (n.children?.length === 1 && contains(n));
    return { ...n, ...(list ? { id: 'episode-list', style: { ...n.style, display: 'flex', 'flex-direction': 'column', 'overflow-x': 'visible', 'overflow-y': 'visible', 'grid-template-columns': '1fr' }, small: { ...n.small, display: 'flex', 'flex-direction': 'column' } } : {}), children: [...(list && n.children?.some(c => c.type === 'repeat' && c.over === 'detail.episodes') ? [skeleton] : []), ...(n.children?.map(walk) ?? [])] };
  };
  return walk(root);
}

// These rows have no press or focus target while the chosen season is being read.
const skeleton: Node = { type: 'box', when: [{ test: 'detail.episodesPending' }], style: { display: 'flex', 'flex-direction': 'column', gap: '18px' }, children: [0, 1, 2].map(() => ({ type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '20px', padding: '18px 16px', 'align-items': 'center' }, children: [
  { type: 'box', style: { width: '220px', height: '124px', 'border-radius': '8px', 'background-color': '$ui.glass' }, small: { width: '128px', height: '72px' } },
  { type: 'box', style: { flex: '1', height: '18px', 'border-radius': '4px', 'background-color': '$ui.glass' } },
] })) };
