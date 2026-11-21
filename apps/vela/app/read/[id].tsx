// Reading a book (docs/media-kinds.md): the reader full screen, its document asked of the server
// when it opens, the viewer's place saved as they read and when they leave.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useVelaState } from '@vela/core/react';
import { HostContext } from '@vela/skin/src/host';
import { ReaderPage } from '@vela/skin/src/widgets/media/reader';
import { DEFAULT_READER_SETTINGS, type ReaderLocation, type ReaderSettings } from '@vela/skin/src/widgets/media/reader-engine';
import { preferences } from '../../src/data/preferences';
import { createReaderEngine } from '../../src/media/reader-engine';
import { useVela } from '../../src/vela';

const SETTINGS = 'reader-settings';
const SAVE_AFTER_MS = 1500;

export default function Read() {
  const { id = '', library } = useLocalSearchParams<{ id: string; library?: string }>();
  const vela = useVela();
  const store = vela.store;
  const detail = useVelaState(state => state.titles[id]);
  const card = detail?.value?.title[0];
  const host = vela.host('title', id, library);
  const engine = useMemo(() => createReaderEngine(), []);
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    try { return { ...DEFAULT_READER_SETTINGS, ...JSON.parse(preferences.get(SETTINGS) || '{}') as Partial<ReaderSettings> }; }
    catch { return DEFAULT_READER_SETTINGS; }
  });
  useEffect(() => { void store.catalogue.title(id); }, [store, id]);
  const changeSettings = useCallback((next: ReaderSettings) => {
    setSettings(next);
    try { preferences.set(SETTINGS, JSON.stringify(next)); } catch { /* Kept for this visit only. */ }
  }, []);
  // Where the viewer is, sent a moment after they stop turning pages and when they leave.
  const pending = useRef<(ReaderLocation & { observedAt: string }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const location = pending.current;
    pending.current = null;
    if (location) void store.media.saveReadingProgress(id, location.locator, location.fraction, location.chapter || undefined, location.observedAt).catch(() => undefined);
  }, [store, id]);
  const onLocation = useCallback((location: ReaderLocation) => {
    // When the reader was there, so a late sync cannot overwrite newer progress from another device.
    pending.current = { ...location, observedAt: new Date().toISOString() };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_AFTER_MS);
  }, [flush]);
  useEffect(() => () => flush(), [flush]);
  const open = useCallback(async () => {
    const grant = await store.media.openReading(id);
    return { url: grant.url, format: grant.format, mimeType: grant.mimeType, locator: grant.progress?.locator, fraction: grant.progress?.fraction };
  }, [store, id]);
  const close = useCallback(() => {
    flush();
    if (router.canGoBack()) router.back(); else router.replace({ pathname: '/title/[id]', params: { id, library: library ?? '' } });
  }, [flush, id, library]);
  if (!host || !card) return <View style={{ flex: 1, backgroundColor: '#fbf9f4' }} />;
  return (
    <HostContext.Provider value={host}>
      <ReaderPage card={card} open={open} engine={engine} settings={settings} onSettings={changeSettings} onLocation={onLocation} onClose={close} />
    </HostContext.Provider>
  );
}
