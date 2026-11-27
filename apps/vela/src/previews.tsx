// Trailer previews on home: tells core where previews may play (home in front and visible, no
// query, motion allowed) and which hero is on show and on screen, and provides the cards'
// intents and the surface that plays a grant. Core does the waiting, asking and cancelling.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { Vela as Store, VelaState } from '@vela/core';
import { PreviewProvider } from '@vela/skin/src/widgets/common/preview';
import { PreviewSurface } from './preview-surface';
import { appRenderTier } from './render-tier';

interface Props {
  store: Store;
  state: VelaState;
  /** Home is the route in front. */
  onHome: boolean;
  heroIndex: number;
  still: boolean;
  searchFocused: boolean;
  children: ReactNode;
}

function useForeground(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => setActive(next !== 'background'));
    return () => subscription.remove();
  }, []);
  return active;
}

export function Previews({ store, state, onHome, heroIndex, still, searchFocused, children }: Props) {
  const foreground = useForeground();
  const home = state.home.value;
  const hero = home?.hero[heroIndex % Math.max(1, home.hero.length)];
  // The heroes whose art is on screen, as their heroPreview widgets report it.
  const [visibleHeroes, setVisibleHeroes] = useState<ReadonlySet<string>>(() => new Set());
  const heroVisible = useCallback((id: string, visible: boolean) => {
    setVisibleHeroes(current => {
      if (current.has(id) === visible) return current;
      const next = new Set(current);
      if (visible) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const previewable = hero && home?.heroPreviewIds.includes(hero.id);
  const heroId = hero && previewable && visibleHeroes.has(hero.id) ? hero.id : '';
  // The lite tier plays no trailers: a second video decode starves the UI on such hardware.
  const offered = !!PreviewSurface && !!home?.trailerPreviewAvailable && appRenderTier() !== 'lite';
  const allowed = offered && onHome && foreground && !still && !searchFocused && state.search.query === '';

  useEffect(() => {
    store.previews.setContext({ allowed, heroId });
  }, [store, allowed, heroId]);

  // One intent for the store's lifetime: a card's widget re-reports its intent whenever this
  // changes, and a fresh one per grant would read as leaving and re-entering, stopping the trailer.
  const intent = useCallback(
    (card: string, row: string, on: boolean) => store.previews.intent(card, row, on),
    [store],
  );
  const heroEnded = useCallback((id: string) => store.previews.heroDone(id), [store]);
  const { cardId, url } = state.previews;
  const source = useMemo(() => {
    if (!PreviewSurface) return null;
    return {
      cardUrl: cardId ? url : '',
      heroUrl: cardId ? '' : url,
      intent,
      heroVisible,
      heroEnded,
      Surface: PreviewSurface,
    };
  }, [intent, heroVisible, heroEnded, cardId, url]);

  if (!source) return <>{children}</>;
  return <PreviewProvider value={source}>{children}</PreviewProvider>;
}
