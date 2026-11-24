// Plugin overlays over the player (docs/plugin-screens.md: Surfaces, playerOverlay): the score bug,
// the ticker, any plugin's corner or band. The contributions that apply to what is playing stand
// at their anchors (at most two each), clipped to their boxes; the corners glide under the top bar
// while the chrome stands, as the score bug always did, and the bottom band lifts what sits on the
// picture's bottom edge by its height. While the chrome is hidden an overlay takes no focus on TV;
// while it stands, the overlay's controls are reachable after the top bar's. Each overlay has a
// switch in the player (a chrome button for `toggle` ones, a row in the subtitles menu for all),
// remembered per viewer by Ether.
import { useCallback, useMemo, useState } from 'react';
import { Platform, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import type { SurfaceContext, SurfaceContribution } from '../../../protocol/screen';
import { useVela, useVelaState } from '@vela/core/react';
import { useHost } from '../host';
import { EASE_OUT } from '../presence';
import type { PlayerLook } from '../widgets/player/look';
import { bandLift, overlayBox, overlayContext, overlayVisible, playerOverlays, type Anchor, type PlayerFacts } from './model';
import { SurfaceView, useSurfacesEnabled } from './view';

export interface OverlaySwitch {
  id: string;
  label: string;
  on: boolean;
  /** A `toggle` overlay (the ticker) also has a chrome button. */
  button: boolean;
  toggle(): void;
}

export interface PlayerSurfaces {
  /** Plugin overlays draw in this player (the app enables them). */
  enabled: boolean;
  shown: SurfaceContribution[];
  switches: OverlaySwitch[];
  context: { server: SurfaceContext; local: SurfaceContext };
  /** How far the bottom band lifts the bottom bar, the live notice and subtitles (0 without one). */
  lift: number;
  setBand(height: number): void;
}

const NO_SURFACES: SurfaceContribution[] = [];
const NO_SETTINGS: Record<string, boolean> = {};

export function usePlayerSurfaces(facts: PlayerFacts): PlayerSurfaces {
  const vela = useVela();
  const enabled = useSurfacesEnabled();
  const { viewport } = useHost();
  const surfaces = useVelaState(state => state.home.value?.surfaces ?? NO_SURFACES);
  const settings = useVelaState(state => state.screens?.settings ?? NO_SETTINGS);
  const [band, setBandHeight] = useState(0);
  const { shown, switchable } = useMemo(
    () => (enabled ? playerOverlays(surfaces, { kind: facts.kind, eventFeed: facts.feed }, settings) : { shown: NO_SURFACES, switchable: NO_SURFACES }),
    [enabled, surfaces, facts.kind, facts.feed, settings]);
  const context = overlayContext(facts);
  const switches = useMemo(() => switchable.map(surface => {
    const on = shown.includes(surface);
    return { id: surface.id, label: surface.setting?.label ?? surface.id, on, button: surface.visibility === 'toggle',
      toggle: () => { void vela.screens.setSurfaceEnabled(surface.id, !on).catch(() => undefined); } };
  }), [switchable, shown, vela]);
  const banded = shown.some(surface => surface.anchor === 'bottom');
  const setBand = useCallback((height: number) => setBandHeight(h => (Math.abs(h - height) < 0.5 ? h : height)), []);
  return { enabled, shown, switches, context, lift: banded ? bandLift(band, { height: viewport.height }) : 0, setBand };
}

interface Props {
  look: PlayerLook;
  surfaces: PlayerSurfaces;
  chrome: boolean;
  /** Where the chrome's top bar ends. */
  top: number;
}

/** Room around a corner's box for its shadow: the box clips content, not the shade beside it. */
const SHADE = 24;

export function PlayerOverlays({ look, surfaces, chrome, top }: Props) {
  const host = useHost();
  const { viewport } = host;
  if (!surfaces.enabled || !surfaces.shown.length) return null;
  const frame = { width: viewport.width, height: viewport.height, small: look.small, size: look.size, chrome, top };
  const anchors: Anchor[] = ['topLeft', 'topRight', 'bottom'];
  const unfocusable = Platform.isTV && !chrome;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
      {anchors.map(anchor => {
        const here = surfaces.shown.filter(surface => (surface.anchor ?? 'topLeft') === anchor && overlayVisible(surface, chrome));
        if (!here.length) return null;
        const box = overlayBox(anchor, frame);
        const views = here.map(surface => (
          <SurfaceView key={`${surface.id}|${JSON.stringify(surfaces.context.server)}`} surface={surface} context={surfaces.context}
            host={host} overPicture unfocusable={unfocusable} />
        ));
        if (anchor === 'bottom') {
          return (
            <View key={anchor} testID="player-overlay-bottom" pointerEvents="box-none"
              onLayout={(event: LayoutChangeEvent) => surfaces.setBand(event.nativeEvent.layout.height)}
              style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: box.maxHeight, overflow: 'hidden' }}>
              {views}
            </View>
          );
        }
        const glide = {
          transform: [{ translateY: box.shift }],
          ...(look.still ? {} : { transitionProperty: ['transform'], transitionDuration: 420, transitionTimingFunction: EASE_OUT }),
        } as ViewStyle;
        const side = anchor === 'topLeft' ? { left: box.left! - SHADE, alignItems: 'flex-start' as const } : { right: box.right! - SHADE, alignItems: 'flex-end' as const };
        return (
          <View key={anchor} testID={`player-overlay-${anchor}`} pointerEvents="box-none"
            style={[{ position: 'absolute', top: box.top! - SHADE, ...side, maxWidth: box.maxWidth + SHADE * 2, maxHeight: box.maxHeight + SHADE * 2,
              padding: SHADE, overflow: 'hidden', gap: look.size(8) }, glide]}>
            {views}
          </View>
        );
      })}
    </View>
  );
}
