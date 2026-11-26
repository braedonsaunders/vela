// The reader engine on iPhone, iPad and Android phones and tablets: the web engine itself in an
// Expo DOM component (reader-surface.tsx), driven from here. The app downloads the document with
// its own networking (the read URL is a short-lived ticket on the selected server; nothing else is
// sent and nothing reaches the web view but the bytes), then the page pulls them a slice at a time.
// Commands go to the page through its handle; places, taps and the opened book come back.
// TV has no reader (books offer no Read there, widgets/media/pages.tsx): null, as for any host
// without a web view.
import { useRef } from 'react';
import { Platform } from 'react-native';
import { fetch as download } from 'expo/fetch';
import type { ReaderBook, ReaderEngine, ReaderLocation, ReaderSettings } from '@vela/skin/src/blocks/read/reader-engine';
import { readerChunk } from '@vela/skin/src/blocks/read/reader-bytes';
import type { ReaderSurfaceHandle, SurfaceSource } from './reader-surface';

type Input = Parameters<Parameters<ReaderEngine['onInput']>[0]>[0];
const INPUTS: readonly string[] = ['next', 'previous', 'toggle-chrome', 'show-chrome', 'escape'];

export function createReaderEngine(): ReaderEngine | null {
  if (Platform.isTV || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return null;
  // Loaded only where a reader is drawn: TV builds carry no DOM web view.
  const ReaderSurface = (require('./reader-surface') as typeof import('./reader-surface')).default;

  let handle: ReaderSurfaceHandle | null = null;
  let bytes: Uint8Array | null = null;
  let source: SurfaceSource | null = null;
  let settings: ReaderSettings | null = null;
  /** The last place reported, so a web view the system reloads reopens where the viewer was. */
  let place: { locator?: string; fraction?: number } = {};
  let opened = false;
  /** Each open is one generation; destroy ends it (the page may open the engine again). */
  let generation = 0;
  let pending: { resolve(book: ReaderBook): void; reject(reason: Error): void } | null = null;
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>(resolve => { markReady = resolve; });
  const locations = new Set<(location: ReaderLocation) => void>();
  const inputs = new Set<(input: Input) => void>();

  const send = () => {
    if (!handle || !source || !settings) return;
    (handle.open as (...args: unknown[]) => void)(source, settings, place.locator ?? null);
  };

  function Surface({ page }: { page: string }) {
    const ref = useRef<ReaderSurfaceHandle>(null);
    return (
      <ReaderSurface
        ref={ref}
        page={page}
        dom={{
          style: { flex: 1, backgroundColor: 'transparent' },
          containerStyle: { flex: 1, backgroundColor: page },
          // The book pages itself (foliate turns on a swipe); the web view must neither scroll nor bounce.
          scrollEnabled: false,
          bounces: false,
          overScrollMode: 'never',
          contentInsetAdjustmentBehavior: 'never',
          automaticallyAdjustContentInsets: false,
          showsHorizontalScrollIndicator: false,
          showsVerticalScrollIndicator: false,
        }}
        onReady={async () => {
          handle = ref.current;
          markReady();
          // The system reloaded the web view (its process was reclaimed): the book opens again where the viewer was.
          if (opened) send();
        }}
        onChunk={async offset => (bytes ? readerChunk(bytes, offset) : '')}
        onOpened={async book => {
          opened = true;
          // Settings changed while the page was opening reach it now.
          command('apply', settings);
          pending?.resolve(book);
          pending = null;
        }}
        onFailed={async reason => {
          console.warn('Vela reader: the book could not be opened', reason);
          pending?.reject(new Error(reason));
          pending = null;
        }}
        onLocation={async location => {
          place = { locator: location.locator, fraction: location.fraction };
          if (source) source = { ...source, fraction: location.fraction };
          for (const listener of [...locations]) listener(location);
        }}
        onInput={async input => {
          if (!INPUTS.includes(input)) return;
          for (const listener of [...inputs]) listener(input as Input);
        }}
      />
    );
  }

  const command = (name: 'next' | 'previous' | 'goTo' | 'goToFraction' | 'apply', ...args: unknown[]) => {
    if (opened && handle) (handle[name] as (...values: unknown[]) => void)(...args);
  };

  return {
    Surface,
    async open(document, _host, initial, locator) {
      const current = ++generation;
      settings ??= initial;
      opened = false;
      place = { locator, fraction: document.fraction };
      const response = await download(document.url, { credentials: 'omit' });
      if (!response.ok) throw new Error(`The book could not be downloaded (${response.status})`);
      const body = new Uint8Array(await response.arrayBuffer());
      if (!body.length) throw new Error('The book is empty');
      if (current !== generation) throw new Error('The reader closed while the book downloaded');
      bytes = body;
      source = { format: document.format, mimeType: document.mimeType, size: bytes.length, ...(document.fraction !== undefined ? { fraction: document.fraction } : {}) };
      await ready;
      if (current !== generation) throw new Error('The reader closed while the book downloaded');
      return new Promise<ReaderBook>((resolve, reject) => {
        pending = { resolve, reject };
        send();
      });
    },
    next() { command('next'); },
    previous() { command('previous'); },
    goTo(href) { command('goTo', href); },
    goToFraction(fraction) { command('goToFraction', fraction); },
    apply(next) { settings = next; command('apply', next); },
    onLocation(listener) { locations.add(listener); return () => locations.delete(listener); },
    onInput(listener) { inputs.add(listener); return () => inputs.delete(listener); },
    destroy() {
      generation++;
      opened = false;
      pending?.reject(new Error('The reader closed'));
      pending = null;
      bytes = null;
      source = null;
    },
  };
}
