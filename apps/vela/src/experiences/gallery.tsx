import { router } from '../router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, View } from 'react-native';
import { msg } from '@vela/core';
import { useScreenPage, useVelaState } from '@vela/core/react';
import { focusElement, type SkinHost } from '@vela/skin';
import { useBlockLook } from '@vela/skin/src/blocks/look';
import { GalleryOpenPhotoContext } from '@vela/skin/src/blocks/gallery/viewer-nav';
import { holdBack } from '@vela/skin/src/menu-key';
import { builtinHref, builtinScreenId } from '@vela/skin/src/resolve/builtin';
import { ExperienceView } from '@vela/skin/src/screen/experience';
import { addressOfPlace, placeOfAddress, type ExperiencePlace } from '@vela/skin/src/screen/experience-route';
import { LibraryTabStrip } from '@vela/skin/src/widgets/library/presentation';
import { Button } from '@vela/skin/src/widgets/library/toolbar-controls';
import type { LibraryParams } from '../browse/library-query';
import { DocumentScreen } from '../screen';
import { useAppScreenActions } from '../screen-actions';
import { openGalleryPhoto } from './gallery-sequence';
import { galleryTab, galleryPlace, hasGalleryEntries, TIMELINE_PLACE } from './gallery-place';
import { StockGalleryLibrary } from './gallery-stock';

const goHome = () => router.replace('/');
const setParams = (params: Record<string, string>) => router.setParams(params);

export function GalleryLibrary({ id, params }: { id: string; params: LibraryParams & { m?: string; galleryName?: string } }) {
  if (process.env.EXPO_PUBLIC_VELA_GALLERY_STOCK === '1') return <StockGalleryLibrary id={id} params={params} />;
  return <TimelineLibrary id={id} address={params.m} name={params.galleryName} />;
}

function TimelineLibrary({ id, address, name }: { id: string; address?: string; name?: string }) {
  const draw = useCallback((host: SkinHost, active: boolean) => (
    <GalleryLibraryExperience id={id} address={address} name={name} host={host} active={active} />
  ), [id, address, name]);
  return <DocumentScreen route="library" entry={id} sharedShell libraryScene={draw} />;
}

function useDirectory(id: string, page: 'albums' | 'people') {
  const advertised = useVelaState(state => state.libraries.value?.find(library => library.id === id)?.tabs?.some(tab =>
    page === 'albums'
      ? tab.level === 'album' && (tab.kind === 'library' || tab.kind === 'view' && tab.search !== true)
      : tab.kind === 'people' && tab.facet === 'subject'));
  const { page: directory } = useScreenPage(advertised ? {
    target: { kind: 'screen', id: builtinScreenId('gallery'), page }, href: builtinHref('gallery', page), params: { library: id },
  } : undefined);
  return hasGalleryEntries(directory?.sources.entries);
}

function GalleryLibraryExperience({ id, address, name, host, active }: {
  id: string; address?: string; name?: string; host: SkinHost; active: boolean;
}) {
  const place = useMemo(() => {
    const parsed = placeOfAddress(address);
    return galleryPlace({ ...parsed, params: { ...parsed.params, ...(name ? { name } : {}) } });
  }, [address, name]);
  const tab = galleryTab(place.page);
  const albums = useDirectory(id, 'albums');
  const people = useDirectory(id, 'people');
  const restore = useRef('');
  const actions = useAppScreenActions({ host, back: goHome, setParams });
  const open = useCallback((photo: string, pageKey: string) => openGalleryPhoto(photo, id, pageKey), [id]);
  const go = useCallback((next: ExperiencePlace) => {
    const { m, rest } = addressOfPlace(galleryPlace(next));
    router.setParams({ m, galleryName: rest.name || '' });
  }, []);
  const parent = place.page === 'album' ? 'albums' : place.page === 'person' ? 'people' : undefined;
  const back = useCallback(() => {
    if (!parent) return false;
    restore.current = `gallery-${place.page}-${place.params.id}`;
    go({ page: parent, params: {} });
    return true;
  }, [parent, place, go]);
  useEffect(() => {
    if (!active || !parent) return;
    if (Platform.OS !== 'web') return holdBack(back);
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return;
      if (back()) event.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active, parent, back]);
  useEffect(() => {
    const target = restore.current;
    if (!target || !active || parent) return;
    let frame = 0;
    let attempts = 0;
    const focus = () => {
      const moved = focusElement(target, true);
      if (moved && (Platform.OS !== 'web' || document.activeElement?.id === target)) restore.current = '';
      else if (++attempts < 60) frame = requestAnimationFrame(focus);
      else restore.current = '';
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [active, parent, place.page]);

  const header = <GalleryHeader tab={tab} albums={albums} people={people} back={parent ? back : undefined} select={id => {
    go(id === 'albums' || id === 'people' ? { page: id, params: {} } : TIMELINE_PLACE);
  }} />;
  return (
    <GalleryOpenPhotoContext.Provider value={open}>
      <ExperienceView experience="gallery" libraryId={id} place={place} go={go} host={host} active={active} actions={actions} pageHeader={header} />
    </GalleryOpenPhotoContext.Provider>
  );
}

function GalleryHeader({ tab, albums, people, select, back }: {
  tab: string; albums: boolean; people: boolean; select(id: string): void; back?: () => void;
}) {
  const look = useBlockLook();
  const tabs = [
    { id: 'timeline', label: msg('gallery.allPhotos') },
    ...(albums ? [{ id: 'albums', label: msg('media.ui.albums') }] : []),
    ...(people ? [{ id: 'people', label: msg('gallery.people') }] : []),
  ];
  return (
    <View testID="gallery-toolbar" accessibilityRole="toolbar" accessibilityLabel={msg('library.toolbar')}
      style={{ paddingHorizontal: look.gutter, paddingVertical: look.px(8), flexShrink: 0 }}>
      {back
        ? <Button icon="back" label={tabs.find(item => item.id === tab)?.label ?? msg('media.ui.back')}
          accessibilityLabel={msg('library.backTo', { tab: tab === 'albums' ? msg('media.ui.albums') : msg('gallery.people') })} onPress={back} />
        : <LibraryTabStrip tabs={tabs} activeId={tab} select={select} />}
    </View>
  );
}
