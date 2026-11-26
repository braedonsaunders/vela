import { useCallback, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { View, type LayoutChangeEvent } from 'react-native';
import { useVelaState } from '@vela/core/react';
import { ScreenActive, type SkinHost } from '@vela/skin';
import { HostContext, useHost } from '@vela/skin/src/host';
import { PhotoNavigationContext, PhotoViewerTopBar } from '@vela/skin/src/blocks/gallery/viewer-nav';
import { MediaActionsContext } from '@vela/skin/src/blocks/media/context';
import { MediaFrame } from '@vela/skin/src/blocks/media/title';
import { MediaFrameViewport } from '@vela/skin/src/blocks/media/viewport';
import { MediaTitlePending } from '@vela/skin/src/blocks/media/title-pending';
import { withInlineMediaTitleActions } from '@vela/skin/src/resolve/media-title';
import { builtinHref, builtinScreenId } from '@vela/skin/src/resolve/builtin';
import { ScreenView } from '@vela/skin/src/screen/host';
import { FocusBoundary } from '../focus-boundary';
import { useMediaPageActions } from '../media/actions';
import { useMediaPlayerActions } from '../media/player-actions';
import { useReaderActions } from '../media/reader-actions';
import { DocumentScreen } from '../screen';
import { useAppScreenActions } from '../screen-actions';
import { useVela } from '../vela';
import { useFullscreenPhotoToastDeferral } from '../surfaces';
import { useGallerySequence } from './gallery-sequence';

interface Props {
  id: string;
  library?: string;
  galleryFrom?: string;
  active: boolean;
  back(): void;
}

const target = { kind: 'screen', id: builtinScreenId('gallery'), page: 'photo' } as const;
const href = builtinHref('gallery', 'photo');
const setParams = (params: Record<string, string>) => router.setParams(params);

export function GalleryTitleScreen({ id: initialId, library, galleryFrom, active, back }: Props) {
  const { id, navigation } = useGallerySequence(initialId, library, galleryFrom, active);
  useFullscreenPhotoToastDeferral(active && navigation?.fullscreen === true);
  const [height, setHeight] = useState<number>();
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.height;
    if (measured > 0) setHeight(measured);
  }, []);
  const viewport = useMemo(() => ({ height, onLayout }), [height, onLayout]);
  const vela = useVela();
  const host = vela.host('title', id, library);
  const frame = vela.doc?.mediaTitleSlot;
  const frameWithControls = useMemo(() => frame && withInlineMediaTitleActions(frame), [frame]);
  const actions = useMediaPageActions(library, back, useMediaPlayerActions(), useReaderActions(library));
  const page = useCallback((current: SkinHost): SkinHost => ({
    ...current,
    // The modal's route still owns Back and focus, while the frame describes the selected photo.
    env: host?.env ?? current.env,
    mediaTitleActions: navigation ? <PhotoViewerTopBar /> : undefined,
    children: <GalleryTitlePage id={id} library={library} active={active} back={back} framed />,
  }), [host, id, library, active, back, !!navigation]);
  const body = frame ? (
    <DocumentScreen route="title" entry={initialId} library={library} node={navigation ? frameWithControls : frame} page={page} />
  ) : host ? (
    <ScreenActive.Provider value={active}>
      <FocusBoundary active={active} enterWhenReady style={{ flex: 1 }} accessibilityViewIsModal>
        <HostContext.Provider value={host}>
          <GalleryTitlePage id={id} library={library} active={active} back={back} framed={false} />
        </HostContext.Provider>
      </FocusBoundary>
    </ScreenActive.Provider>
  ) : <View style={{ flex: 1 }} />;
  return (
    <MediaFrameViewport.Provider value={viewport}>
      <PhotoNavigationContext.Provider value={navigation}>
        <MediaActionsContext.Provider value={actions}>{body}</MediaActionsContext.Provider>
      </PhotoNavigationContext.Provider>
    </MediaFrameViewport.Provider>
  );
}

function GalleryTitlePage({ framed, id, library, active, back }: Props & { framed: boolean }) {
  const host = useHost();
  const pageHost = useMemo(() => host.children === undefined ? host : { ...host, children: undefined }, [host]);
  const detail = useVelaState(state => state.titles[id]);
  const card = detail?.value?.title[0];
  const params = useMemo(() => ({ id, library: library ?? '' }), [id, library]);
  const actions = useAppScreenActions({ host: pageHost, back, setParams });
  return (
    <MediaFrame framed={framed} titleActions={!framed ? <PhotoViewerTopBar /> : undefined} accent={card?.accent ?? ''} backdrop={card?.poster ?? ''} wideArt={false}>
      {card
        ? <ScreenView target={target} href={href} params={params} host={pageHost} active={active} actions={actions} route={false} />
        : <MediaTitlePending load={detail ?? { load: 'loading', error: '' }} id={id} />}
    </MediaFrame>
  );
}
