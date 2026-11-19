// What a watch route draws: the player view filling a black stage (the picture's letterbox),
// with the chrome over it, inside the active document's host so the chrome takes its look.
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { HostContext, type SkinHost } from '../../host';
import { PlayerChrome } from './chrome';
import { PlayerChromeContext, type PlayerChromeState } from './context';

interface Props {
  host: SkinHost;
  state: PlayerChromeState;
  /** The player view, drawn under the chrome. */
  children: ReactNode;
}

export function WatchSurface({ host, state, children }: Props) {
  return (
    <HostContext.Provider value={host}>
      <PlayerChromeContext.Provider value={state}>
        <View style={styles.stage} testID="watch-stage">
          {children}
          {/* Only interactive chrome respects cutouts and system bars. The video and its
              aspect-ratio letterbox fill the stage, including on a folding display. */}
          <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, {
            top: host.viewport.insets.top,
            bottom: host.viewport.insets.bottom,
            left: host.viewport.sides?.left ?? host.viewport.insets.left,
            right: host.viewport.sides?.right ?? host.viewport.insets.right,
          }]}>
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
