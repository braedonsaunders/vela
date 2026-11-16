// Trailer previews (renderer 16): widget `cardPreview` inside a card of a preview row reports the
// card's hover or focus (its group's) as intent, and draws the muted preview filling its box while
// that card's preview plays; `heroPreview` draws the current hero's. The app provides the source:
// the playing previews' URLs, where intent goes (it waits, asks the server and cancels), and the
// Surface that plays a URL (a muted ambient player view), so the skin takes no player dependency.
// Which card and hero are previewing is `env.preview`, the one record documents and widgets read:
// documents draw their overlay around the widget with `card.previewing` / `hero.previewing`. A
// `cardPreview` must stay mounted while its card is idle (it is what reports the intent): show
// its overlay through a state on `card.previewing` (opacity, scale), not a `when` on it.
import { createContext, useContext, useEffect, type ComponentType, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { GroupContext, useHost, type WidgetProps } from '../../host';

export interface PreviewSource {
  /** The URL of the card preview playing now (`env.preview.cardId`), or ''. */
  cardUrl: string;
  /** The URL of the hero preview playing now (`env.preview.heroId`), or ''. */
  heroUrl: string;
  /** Hover or focus came to (on) or left a previewable card. */
  intent(cardId: string, rowId: string, on: boolean): void;
  /** Plays a preview URL, muted, filling its box. */
  Surface: ComponentType<{ url: string }>;
}

const PreviewContext = createContext<PreviewSource | null>(null);

export function PreviewProvider({ value, children }: { value: PreviewSource; children: ReactNode }) {
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

function Playing({ Surface, url }: { Surface: PreviewSource['Surface']; url: string }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Surface url={url} />
    </View>
  );
}

export function CardPreview({ ctx }: WidgetProps) {
  const { env } = useHost();
  const source = useContext(PreviewContext);
  const group = useContext(GroupContext);
  const cardId = ctx.card?.id ?? '';
  const rowId = ctx.row?.id ?? '';
  const previewable = !!source && cardId !== '' && ctx.row?.previewOnFocus === true;
  const active = previewable && !!group && (group.hover || group.focus);
  const intent = source?.intent;
  useEffect(() => {
    if (!active || !intent) return;
    intent(cardId, rowId, true);
    return () => intent(cardId, rowId, false);
  }, [active, intent, cardId, rowId]);
  const playing = source && cardId !== '' && env.preview?.cardId === cardId ? source.cardUrl : '';
  return source && playing ? <Playing Surface={source.Surface} url={playing} /> : null;
}

export function HeroPreview({ ctx }: WidgetProps) {
  const { env } = useHost();
  const source = useContext(PreviewContext);
  const heroId = ctx.hero?.id ?? '';
  const playing = source && heroId !== '' && env.preview?.heroId === heroId ? source.heroUrl : '';
  return source && playing ? <Playing Surface={source.Surface} url={playing} /> : null;
}
