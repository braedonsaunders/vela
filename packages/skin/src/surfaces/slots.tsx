// Plugin surfaces inside skin pages (docs/plugin-screens.md: Surfaces): a Home row a plugin fills
// (`homeRow`, where Ether lists it among the rows; at most 1.5 times a card row high) and panels on
// title pages for a plugin's own kinds (`titlePanel`, after the related rows, with the title as
// context). Both draw in the skin's own look, quietly (nothing while loading, nothing on failure).
import { useMemo } from 'react';
import { View } from 'react-native';
import { useVelaState } from '@vela/core/react';
import type { SurfaceContribution } from '../../../protocol/screen';
import { surfaceSlot } from '../../../protocol/experiences';
import { PX } from '../css';
import { useHost } from '../host';
import { slotContext, slotSurfaces, surfaceApplies } from './model';
import { SurfaceView } from './view';

const NO_SURFACES: SurfaceContribution[] = [];
/** A card row's height in design px (a landscape shelf with its heading); a Home-row surface gets 1.5 times it. */
const CARD_ROW = 300;

export function HomeRowSurface({ id, surface: surfaceId }: { id: string; surface: string }) {
  const host = useHost();
  const surface = useVelaState(state => state.home.value?.surfaces?.find(s => s.id === surfaceId && surfaceSlot(s) === 'home.rows'));
  const context = useMemo(() => ({ server: {} }), []);
  if (!surface) return null;
  return (
    <View testID={`home-surface-${id}`} style={{ maxHeight: CARD_ROW * 1.5 * PX, overflow: 'hidden' }}>
      <SurfaceView surface={surface} context={context} host={host} />
    </View>
  );
}

const itemKey = (id: string) => (id.startsWith('item:') ? id : `item:${id}`);

/** The title panels whose `when.titleKind` matches the title's kind. */
export function TitlePanels({ id, kind }: { id: string; kind: string }) {
  const host = useHost();
  const surfaces = useVelaState(state => state.home.value?.surfaces ?? NO_SURFACES);
  const panels = useMemo(() => surfaces.filter(s => surfaceSlot(s) === 'title.panel' && surfaceApplies(s, { titleKind: kind })), [surfaces, kind]);
  const context = useMemo(() => ({ server: { title: itemKey(id) } }), [id]);
  if (!panels.length) return null;
  return (
    <View testID="title-surfaces" style={{ alignSelf: 'stretch', gap: 24 * PX }}>
      {panels.map(surface => <SurfaceView key={`${surface.id}|${id}`} surface={surface} context={context} host={host} />)}
    </View>
  );
}

export function PluginSlotSurfaces({ slot, context, limit }: { slot: string; context: Record<string, string>; limit?: number }) {
  const host = useHost();
  const surfaces = useVelaState(state => state.home.value?.surfaces ?? NO_SURFACES);
  const key = JSON.stringify(context);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => slotSurfaces(surfaces, slot, context, limit), [surfaces, slot, key, limit]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => slotContext(context), [key]);
  if (!shown.length) return null;
  return (
    <View testID={`slot-${slot}`} style={{ alignSelf: 'stretch', gap: 24 * PX }}>
      {shown.map(surface => <SurfaceView key={`${surface.id}|${key}`} surface={surface} context={value} host={host} />)}
    </View>
  );
}
