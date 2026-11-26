import { router, useFocusEffect, useIsFocused, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';
import { backFromNavigation, useBackHeld } from '@vela/skin/src/menu-key';
import { DocumentScreen } from '../../src/screen';
import { useVela } from '../../src/vela';
import { clearTitleNavigation, isTitleNavigation } from '../../src/title-origin';
import { useVelaState } from '@vela/core/react';
import { opensMediaPage } from '@vela/core';
import { MediaTitleScreen } from '../../src/media/screen';
import { ReadTitleScreen } from '../../src/experiences/read-title';
import { GalleryTitleScreen } from '../../src/experiences/gallery-title';
import { legacyGallery } from '../../src/experiences';
import { closeModal } from '../../src/modal-motion';

export default function Title() {
  const { id, library, media, galleryFrom } = useLocalSearchParams<{ id: string; library?: string; media?: string; galleryFrom?: string }>();
  // A music, book, audiobook, podcast or photo title draws its own page (docs/media-kinds.md):
  // known from the card that opened it, or from the title once read (its card kind: a podcast's
  // show is 'podcast', never video's 'show').
  const kind = useVelaState(state => state.titles[id ?? '']?.value?.title[0]?.kind);
  const revision = useVelaState(state => state.auth.revision);
  const role = kind ?? media ?? '';
  const mediaPage = opensMediaPage(role);
  const { openTitle } = useVela();
  const openedInApp = isTitleNavigation(id);
  // tvOS Menu also reaches the native stack. Close an open description/menu first.
  usePreventRemove(useBackHeld(), backFromNavigation);
  useEffect(() => (id ? openTitle(id) : undefined), [id, openTitle, revision]);
  useEffect(() => () => clearTitleNavigation(id), [id]);
  const back = useCallback(() => closeModal(() => {
    if (openedInApp && router.canGoBack()) router.back();
    else if (library) router.replace({ pathname: '/library/[id]', params: { id: library } });
    else router.replace('/');
  }), [library, openedInApp]);
  const focused = useIsFocused();
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'web') {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
      return () => subscription.remove();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); back(); }
    };
    // A click on the dimmed page around the frame closes it, like Escape. Sheets and menus the
    // page opens are drawn outside the route (portals), so clicks in them never count as outside.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.defaultPrevented || !(event.target instanceof Element)) return;
      if (event.target.closest('[data-testid="detail-route"]') && !event.target.closest('[data-testid="detail-frame"]')) back();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('click', onClick); };
  }, [back]));
  if (role === 'book' || role === 'series') return <ReadTitleScreen page={role} id={id ?? ''} library={library} active={focused} back={back} />;
  if (role === 'photo' && !legacyGallery) return <GalleryTitleScreen id={id ?? ''} library={library} galleryFrom={galleryFrom} active={focused} back={back} />;
  if (mediaPage) return <MediaTitleScreen id={id ?? ''} library={library} active={focused} back={back} />;
  return <DocumentScreen route="title" entry={id ?? ''} library={library} />;
}
