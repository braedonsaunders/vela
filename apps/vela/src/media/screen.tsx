// A media title's page (an album, artist, book, series or audiobook) drawn in place of the
// document's title page, with the active document's look.
import { View } from 'react-native';
import { HostContext } from '@vela/skin/src/host';
import { MediaActionsContext, MediaTitlePage } from '@vela/skin/src/widgets/media';
import { ScreenActive } from '@vela/skin';
import { useVela } from '../vela';
import { FocusBoundary } from '../focus-boundary';
import { useMediaPageActions } from './actions';
import { useMediaPlayerActions } from './player-actions';
import { useReaderActions } from './reader-actions';

export function MediaTitleScreen({ id, library, active, back }: { id: string; library?: string; active: boolean; back: () => void }) {
  const vela = useVela();
  const host = vela.host('title', id, library);
  const actions = useMediaPageActions(library, back, useMediaPlayerActions(), useReaderActions(library));
  if (!host) return <View style={{ flex: 1 }} />;
  return (
    <ScreenActive.Provider value={active}>
      <FocusBoundary active={active} enterWhenReady style={{ flex: 1 }} accessibilityViewIsModal>
        <HostContext.Provider value={host}>
          <MediaActionsContext.Provider value={actions}>
            <MediaTitlePage id={id} />
          </MediaActionsContext.Provider>
        </HostContext.Provider>
      </FocusBoundary>
    </ScreenActive.Provider>
  );
}
