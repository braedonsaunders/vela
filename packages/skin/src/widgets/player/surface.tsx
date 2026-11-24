// What a watch route draws: the player view filling a black stage (the picture's letterbox),
// with the chrome over it, inside the active document's host so the chrome takes its look.
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { HostContext, type SkinHost } from '../../host';
import { PlayerChrome } from './chrome';
import { PlayerChromeContext, type PlayerChromeState } from './context';
import { watchFrames } from './fold-layout';

interface Props {
  host: SkinHost;
  state: PlayerChromeState;
  /** The player view, drawn under the chrome. */
  children: ReactNode;
}

export function WatchSurface({ host, state, children }: Props) {
  const picture = watchFrames(host.viewport).picture;
  return (
    <HostContext.Provider value={host}>
      <PlayerChromeContext.Provider value={state}>
        <View style={styles.stage} testID="watch-stage">
          {/* The video and its aspect-ratio letterbox fill the stage, including on a folding
              display held flat; a tabletop fold gives it the upper half (fold-layout.ts). */}
          <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, picture]}>{children}</View>
          {/* The chrome spans the stage for taps on the picture; its controls keep to the safe
              area and clear of a tabletop's fold (chrome.tsx). */}
          <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 1 }]}>
            <PlayerChrome />
          </View>
        </View>
      </PlayerChromeContext.Provider>
    </HostContext.Provider>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000' },
});
