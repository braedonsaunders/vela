// Trailer previews on home: tells core where previews may play (home in front and visible, no
// query, motion allowed) and which hero is on show, and provides the cards' intents and the
// surface that plays a grant. Core does the waiting, asking and cancelling.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { Vela as Store, VelaState } from '@vela/core';
import { PreviewProvider } from '@vela/skin/src/widgets/common/preview';
import { PreviewSurface } from './preview-surface';

interface Props {
  store: Store;
  state: VelaState;
  /** Home is the route in front. */
  onHome: boolean;
  heroIndex: number;
  still: boolean;
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

export function Previews({ store, state, onHome, heroIndex, still, children }: Props) {
  const foreground = useForeground();
  const home = state.home.value;
  const hero = home?.hero[heroIndex % Math.max(1, home.hero.length)];
  const heroId = hero && home?.heroPreviewIds.includes(hero.id) ? hero.id : '';
  const offered = !!PreviewSurface && !!home?.trailerPreviewAvailable;
  const allowed = offered && onHome && foreground && !still && state.search.query === '';

  useEffect(() => {
    store.previews.setContext({ allowed, heroId });
  }, [store, allowed, heroId]);

  // One intent for the store's lifetime: a card's widget re-reports its intent whenever this
  // changes, and a fresh one per grant would read as leaving and re-entering, stopping the trailer.
  const intent = useCallback(
    (card: string, row: string, on: boolean) => store.previews.intent(card, row, on),
    [store],
  );
  const { cardId, url } = state.previews;
  const source = useMemo(() => {
    if (!PreviewSurface) return null;
    return {
      cardUrl: cardId ? url : '',
      heroUrl: cardId ? '' : url,
      intent,
      Surface: PreviewSurface,
    };
  }, [intent, cardId, url]);

  if (!source) return <>{children}</>;
  return <PreviewProvider value={source}>{children}</PreviewProvider>;
}
