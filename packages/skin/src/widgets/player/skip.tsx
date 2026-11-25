// The skip button (protocol README, "Skip markers"): while the position is inside an intro or credits
// range the plan names, a button at the picture's lower right skips to the range's end; on an
// episode's final credits it starts the next episode instead. It keeps clear of plugin overlays (the
// top corners, and above the bottom band) and stands over the bottom bar while the chrome is up. On
// TV it takes focus as it appears over a hidden chrome, so select skips; with the chrome up it sits
// above the timeline, one press up from it.
import { msg, skipAction, type SkipAction } from '@vela/core';
import { Platform, View } from 'react-native';
import type { PlaybackPlan } from '@vela/player-api';
import { ChromeButton } from './button';
import type { NextEpisode } from './context';
import type { PlayerLook } from './look';

/** The skip button's action at a position, or null (ended, or outside every range). */
export function skipHere(markers: PlaybackPlan['markers'], position: number, ended: boolean, next: NextEpisode | null | undefined): SkipAction | null {
  return ended ? null : skipAction(markers, position, !!next);
}

interface Props {
  look: PlayerLook;
  action: SkipAction;
  next: NextEpisode | null | undefined;
  /** Distance from the stage's bottom edge. */
  bottom: number;
  /** The chrome stands: TV focus stays where the viewer has it. */
  chromeUp: boolean;
  seek(seconds: number): void;
}

export function SkipButton({ look, action, next, bottom, chromeUp, seek }: Props) {
  const text = action.kind === 'next' ? msg('player.nextEpisode') : action.kind === 'intro' ? msg('player.skipIntro') : msg('player.skipCredits');
  const label = action.kind === 'next' && next ? msg('player.nextEpisodeNamed', { name: next.label }) : text;
  return (
    <View pointerEvents="box-none" testID="player-skip"
      style={{ position: 'absolute', right: look.gutter, bottom, borderRadius: look.radiusControl, backgroundColor: look.scrim,
        borderWidth: 1, borderColor: look.glassEdge }}>
      <ChromeButton
        // A new range is a new button: it claims TV focus again as it appears.
        key={action.kind === 'next' ? 'next' : `${action.kind}-${action.toSeconds}`}
        look={look}
        icon={action.kind === 'next' ? 'next' : 'skip'}
        text={text}
        label={label}
        preferred={Platform.isTV && !chromeUp}
        testID={`player-skip-${action.kind}`}
        onPress={() => (action.kind === 'next' ? next?.play() : seek(action.toSeconds))}
      />
    </View>
  );
}
