// One remote listener for the controls that hold focus (see tv-keys.ts). React Native's
// useTVEventHandler subscribes once per component and again whenever its handler changes, so every
// card, button and music tile of a page listened to the remote, each redraw unsubscribed and
// subscribed again through the native event module, and every press ran every card's handler. The
// relay keeps one subscription and hands each press only to the focused controls.

/** A remote event as React Native gives it (`eventType`: left, right, select, longSelect, menu...). */
export interface TVKey {
  eventType?: string;
  eventKeyAction?: number;
}

export type TVKeyHandler = (event: TVKey) => void;

export interface TVKeyRelay {
  /** A focused control's handler (read when a press arrives); returns its removal. */
  add(handler: { current: TVKeyHandler }): () => void;
  /** A remote event: handed to the focused controls. */
  dispatch(event: TVKey): void;
  readonly size: number;
}

export function tvKeyRelay(): TVKeyRelay {
  const handlers = new Set<{ current: TVKeyHandler }>();
  return {
    add(handler) {
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    },
    dispatch(event) {
      // tvOS reports focus changes on the same channel; they are not presses.
      if (event.eventType === 'focus' || event.eventType === 'blur') return;
      for (const handler of [...handlers]) handler.current(event);
    },
    get size() { return handlers.size; },
  };
}
