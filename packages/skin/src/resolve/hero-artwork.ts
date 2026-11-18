import type { Node } from '../../../protocol/skin';

/** Older skins supply their own home stage. Give their backdrop slots the same recovery
 * behavior as the base, retaining each skin's geometry, masks, motion and breakpoints. */
export function withHeroArtwork(node: Node): Node {
  const walk = (node: Node): { node: Node; artwork: boolean } => {
    if (node.type === 'image' && node.src === '{hero.poster}' && node.when?.some(condition => condition.test === 'hero.backdrop' && condition.not)) {
      return { node: { type: 'box', style: { display: 'none' } }, artwork: false };
    }
    let artwork = node.type === 'widget' && node.widget === 'heroArtwork';
    let next = node;
    const phonePoster = node.type === 'image' && node.src === '{hero.poster}' && node.when?.some(condition => condition.test === 'env.small' && !condition.not);
    if (node.type === 'image' && (node.src === '{hero.backdrop}' || phonePoster)) {
      const { src, alt, fade, ...common } = node;
      next = { ...common, type: 'widget', widget: 'heroArtwork' };
      artwork = true;
    } else if (node.type === 'box') {
      const children = (node.children ?? []).map(walk);
      artwork = children.some(child => child.artwork);
      next = { ...node, children: children.map(child => child.node) };
    } else if (node.type === 'repeat') {
      const child = walk(node.item);
      artwork = child.artwork;
      next = { ...node, item: child.node };
    }
    // A failed/missing URL still needs its poster and ambient layer mounted.
    if (artwork) next = { ...next, when: next.when?.filter(condition => !['hero.backdrop', 'hero.poster'].includes(condition.test) || condition.not) };
    return { node: next, artwork };
  };
  const result = walk(node);
  if (result.artwork) return result.node;
  // Text-only featured layouts (Index) still need an ambient/artwork floor.
  const floor = (node: Node): Node => {
    if (node.type === 'repeat' && node.over === 'home.hero' && node.item.type === 'box') return {
      ...node, item: { ...node.item, style: { ...node.item.style, position: 'relative' }, children: [
        { type: 'widget', widget: 'heroArtwork', style: { position: 'absolute', inset: '0px', opacity: '0.22' } },
        ...(node.item.children ?? []),
      ] },
    };
    if (node.type === 'box') return { ...node, children: node.children?.map(floor) };
    return node;
  };
  return floor(result.node);
}
