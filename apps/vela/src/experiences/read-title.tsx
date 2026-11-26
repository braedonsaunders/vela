import { useCallback, useMemo } from 'react';
import { Platform, View } from 'react-native';
import { useVelaState } from '@vela/core/react';
import { ScreenActive, type SkinHost } from '@vela/skin';
import { HostContext, useHost } from '@vela/skin/src/host';
import { MediaActionsContext } from '@vela/skin/src/blocks/media/context';
import { MediaFrame } from '@vela/skin/src/blocks/media/title';
import { readBackdropComponents } from '@vela/skin/src/blocks/read/book-layout';
import { READ_SERIES_PRIMARY } from '@vela/skin/src/blocks/read/series';
import { FocusBoundary } from '../focus-boundary';
import { DocumentScreen } from '../screen';
import { useVela } from '../vela';
import { useMediaPageActions } from '../media/actions';
import { useMediaPlayerActions } from '../media/player-actions';
import { useReaderActions } from '../media/reader-actions';
import { ReadDocument } from './read-document';

const SERIES_FOCUS = [READ_SERIES_PRIMARY];

interface Props {
  id: string;
  page: 'book' | 'series';
  library?: string;
  active: boolean;
  back(): void;
}

export function ReadTitleScreen(props: Props) {
  const { id, library, active, back } = props;
  const vela = useVela();
  const host = vela.host('title', id, library);
  const framed = vela.doc?.mediaTitleSlot;
  const initialTVFocus = props.page === 'series' ? SERIES_FOCUS : undefined;
  const actions = useMediaPageActions(library, back, useMediaPlayerActions(), useReaderActions(library));
  const page = useCallback((current: SkinHost): SkinHost => ({
    ...current,
    children: <ReadTitlePage {...props} framed />,
  }), [id, props.page, library, active, back]);
  if (framed) return (
    <MediaActionsContext.Provider value={actions}>
      <DocumentScreen route="title" entry={id} library={library} node={framed} page={page} initialTVFocus={initialTVFocus} />
    </MediaActionsContext.Provider>
  );
  if (!host) return <View style={{ flex: 1 }} />;
  return (
    <ScreenActive.Provider value={active}>
      <FocusBoundary active={active} enterWhenReady style={{ flex: 1 }} accessibilityViewIsModal>
        <HostContext.Provider value={host}>
          <MediaActionsContext.Provider value={actions}>
            <ReadTitlePage {...props} framed={false} />
          </MediaActionsContext.Provider>
        </HostContext.Provider>
      </FocusBoundary>
    </ScreenActive.Provider>
  );
}

function ReadTitlePage({ framed, ...props }: Props & { framed: boolean }) {
  const host = useHost();
  const pageHost = useMemo(() => host.children === undefined ? host : { ...host, children: undefined }, [host]);
  const card = useVelaState(state => state.titles[props.id]?.value?.title[0]);
  return (
    <MediaFrame framed={framed} accent={card?.accent ?? ''} backdrop={card?.poster ?? ''} wideArt={false}
      backdropComponents={readBackdropComponents(props.page, Platform.OS, Platform.isTV)}>
      <ReadDocument {...props} host={pageHost} />
    </MediaFrame>
  );
}
