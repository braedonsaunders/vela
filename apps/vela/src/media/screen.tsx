// A media title's page (an album, artist, book, series or audiobook). It opens in the active
// document's own title page, exactly as a film does: the framed modal over the dimmed page on
// desktop, web and tablets, full-bleed on phones, with the frame's opening motion and close control
// (resolve/media-title.ts). A document whose title page has no scroll region draws the media page
// on a page of its own.
import { View } from 'react-native';
import { HostContext } from '@vela/skin/src/host';
import { MediaActionsContext, MediaTitlePage } from '@vela/skin/src/widgets/media';
import { ScreenActive } from '@vela/skin';
import { useVela } from '../vela';
import { FocusBoundary } from '../focus-boundary';
import { DocumentScreen } from '../screen';
import { useMediaPageActions } from './actions';
import { useMediaPlayerActions } from './player-actions';
import { useReaderActions } from './reader-actions';

export function MediaTitleScreen({ id, library, active, back }: { id: string; library?: string; active: boolean; back: () => void }) {
  const vela = useVela();
  const host = vela.host('title', id, library);
  const actions = useMediaPageActions(library, back, useMediaPlayerActions(), useReaderActions(library));
  const framed = vela.doc?.mediaTitle;
  if (framed) return (
    <MediaActionsContext.Provider value={actions}>
      <DocumentScreen route="title" entry={id} library={library} node={framed} />
    </MediaActionsContext.Provider>
  );
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
