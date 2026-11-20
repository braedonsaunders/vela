export type PointerMode = 'auto' | 'none';

/** CSS none is inherited but descendants can opt back in. Native none blocks an entire
 * subtree, so boxes pass through while the renderer carries the inherited policy. */
export function pointerPolicy(own: unknown, inherited: PointerMode) {
  const content: PointerMode = own === 'none' ? 'none' : own === 'auto' || own === 'box-none' ? 'auto' : inherited;
  return { content, box: content === 'none' || own === 'box-none' ? 'box-none' as const : 'auto' as const };
}
