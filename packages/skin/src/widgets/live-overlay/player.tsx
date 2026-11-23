// The live overlays inside the player chrome. On a live channel whose programme is a game the
// server knows (playback `liveEvent`), the score bug stands at the top left; while the chrome is
// up it glides down beneath the top bar and back again as the chrome hides, so it is never under
// the close button or the title. The ticker runs along the bottom edge when the viewer turned it
// on; the chrome's bottom bar and the live notice sit on top of it. Alert toasts stand at the top
// right for every kind of playback, below the top bar while the chrome is up and beside the info
// card when that is open.
import { useEffect, useMemo } from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import { SPOILER_DELAY_SECONDS } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import Animated from 'react-native-reanimated';
import { EASE_OUT, MOTION, Presence, useLast } from '../../presence';
import type { PlayerLook } from '../player/look';
import { PlayerAlertToasts } from './alerts';
import { useTickerPreference } from './context';
import { bugModel, delayedEvent, overlayShown } from './model';
import { ScoreBug, useFollowedEvent } from './score-bug';
import { LiveTicker, tickerHeight } from './ticker';

export interface PlayerLiveOverlay {
  /** The server offers live events: the ticker's toggle shows on a live channel. */
  available: boolean;
  /** The event on air, for the score bug ('' for none). */
  eventId: string;
  /** The ticker is on (and this is a live channel). */
  ticker: boolean;
  toggleTicker(): void;
  /** How far the ticker lifts what sits on the bottom edge (0 while it is off). */
  lift: number;
}

export function usePlayerLiveOverlay(look: PlayerLook, live: boolean): PlayerLiveOverlay {
  const vela = useVela();
  // Features arrive with home; reading home re-checks them when the server changes.
  const home = useVelaState(state => state.home.value);
  const available = useMemo(() => !!home && vela.liveEvents.available(), [vela, home]);
  const ref = useVelaState(state => state.playback.liveEvent);
  const [on, setOn] = useTickerPreference();
  const shown = overlayShown(available, live, ref?.id, on);
  return { ...shown, toggleTicker: () => setOn(!on), lift: shown.ticker ? tickerHeight(look) : 0 };
}

interface Props {
  look: PlayerLook;
  overlay: PlayerLiveOverlay;
  /** The chrome stands. */
  chrome: boolean;
  /** Where the chrome's top bar ends. */
  top: number;
  /** The info card is open at the top right. */
  info: boolean;
  /** The channel playing ('' for a film). */
  channelId: string;
  /** How far the picture trails live (paused, rewound, Start over), and the real time it shows. */
  behindSeconds?: number;
  pictureAt?: number;
}

export function PlayerLiveOverlays({ look, overlay, chrome, top, info, channelId, behindSeconds = 0, pictureAt = Date.now() }: Props) {
  const edge = look.small ? 18 : look.size(30);
  const below = chrome ? top : edge;
  const delayed = behindSeconds > SPOILER_DELAY_SECONDS;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
      <LiveTicker look={look} shown={overlay.ticker} withheld={delayed ? overlay.eventId : ''} />
      <Bug look={look} eventId={overlay.eventId} chrome={chrome} shift={top - edge} edge={edge} behindSeconds={behindSeconds} pictureAt={pictureAt} />
      <PlayerAlertToasts look={look} top={below} playingChannelId={channelId}
        right={info && !look.small ? look.gutter + look.size(300) + look.size(14) : undefined} />
    </View>
  );
}

/** The bug at the top left: in with the shared motion when the programme becomes a game, out when
 * it stops being one, and down under the top bar while the chrome stands. */
function Bug({ look, eventId, chrome, shift, edge, behindSeconds, pictureAt }: { look: PlayerLook; eventId: string; chrome: boolean; shift: number; edge: number; behindSeconds: number; pictureAt: number }) {
  const vela = useVela();
  const live = useFollowedEvent(eventId || undefined);
  // Behind live, the plays (when the feed times and scores them) tell the score on screen.
  const delayed = behindSeconds > SPOILER_DELAY_SECONDS;
  const plays = useVelaState(state => (delayed && eventId ? state.liveEvents.details[eventId]?.value?.plays : undefined));
  useEffect(() => { if (delayed && eventId) void vela.liveEvents.loadDetail(eventId); }, [vela, delayed, eventId]);
  // The picture moves a second at a time; the score on screen only needs the minute it shows.
  const pictureMinute = Math.floor(pictureAt / 1000);
  const { event, note } = useMemo(() => delayedEvent(live, plays, pictureMinute * 1000, behindSeconds), [live, plays, pictureMinute, delayed]);
  const shown = !!eventId && !!bugModel(event);
  // It keeps drawing the game it showed while it leaves.
  const last = useLast(shown ? event : undefined);
  const glide = {
    transform: [{ translateY: chrome ? shift : 0 }],
    ...(look.still ? {} : { transitionProperty: ['transform'], transitionDuration: 420, transitionTimingFunction: EASE_OUT }),
  } as ViewStyle;
  return (
    <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', top: edge, left: look.gutter }, glide]}>
      <Presence shown={shown} still={look.still} offstage={{ x: -look.size(18), scale: 0.96 }} exitMs={MOTION.exit}>
        {/* The remote reaches Reveal only while the chrome stands; a pointer or touch always can. */}
        {last ? <ScoreBug event={last} look={look} size={look.small ? 'tile' : 'full'} situation revealable={note ? undefined : chrome} testID="player-score-bug" /> : null}
        {last && note ? (
          <Text testID="player-scores-hidden" style={[look.text(12, 500, look.inkSecondary), { marginTop: look.size(6), paddingHorizontal: look.size(8), paddingVertical: look.size(3),
            borderRadius: look.size(6), backgroundColor: look.scrim, alignSelf: 'flex-start', overflow: 'hidden' }]}>{note}</Text>
        ) : null}
      </Presence>
    </Animated.View>
  );
}
