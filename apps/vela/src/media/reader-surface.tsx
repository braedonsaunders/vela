'use dom';
// The book's pages on iPhone, iPad and Android phones and tablets: the web reader engine
// (reader-engine.web.ts, foliate-js) running in an Expo DOM component, so every client lays out,
// paginates and locates a book the same way. The reader's chrome stays in the app
// (widgets/media/reader.tsx); this page only draws the book. It never sees a server address or a
// credential: the app downloads the document and the page asks it for the bytes a slice at a time
// (reader-engine.ts), then opens them from a blob.
import { useEffect, useRef, type Ref } from 'react';
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from 'expo/dom';
import type { ReaderBook, ReaderEngine, ReaderLocation, ReaderSettings } from '@vela/skin/src/widgets/media/reader-engine';
import { createReaderEngine } from './reader-engine.web';

export interface SurfaceSource { format: 'epub' | 'pdf' | 'cbz'; mimeType: string; size: number; fraction?: number }

type Args = Parameters<DOMImperativeFactory[string]>;

/** The app's commands to the page. Each is one-way; results come back through the props' callbacks. */
export interface ReaderSurfaceHandle extends DOMImperativeFactory {
  open(...args: Args): void;
  next(): void;
  previous(): void;
  goTo(...args: Args): void;
  goToFraction(...args: Args): void;
  apply(...args: Args): void;
}

interface Props {
  ref?: Ref<ReaderSurfaceHandle>;
  dom?: DOMProps;
  /** The paper colour, so the page never flashes white before the book draws. */
  page: string;
  /** The page is listening: its commands can be sent. Sent again if the web view reloads. */
  onReady(): Promise<void>;
  /** The document's bytes from `offset` as base64 ('' past the end). */
  onChunk(offset: number): Promise<string>;
  onOpened(book: ReaderBook): Promise<void>;
  onFailed(reason: string): Promise<void>;
  onLocation(location: ReaderLocation): Promise<void>;
  onInput(input: string): Promise<void>;
}

/** The book's own cover as a data URL the app can draw (the engine's object URL lives only here). */
async function coverData(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const blob = await (await fetch(url)).blob();
    if (!blob.size || blob.size > 1.5 * 1024 * 1024) return undefined;
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch { return undefined; }
}

export default function ReaderSurface(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<ReaderEngine | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    document.documentElement.style.cssText = 'margin:0;padding:0;height:100%;overflow:hidden;';
    document.body.style.cssText = 'margin:0;padding:0;height:100%;overflow:hidden;overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;';
  }, []);
  useEffect(() => { document.body.style.background = props.page; }, [props.page]);

  useDOMImperativeHandle(props.ref ?? null, () => ({
    open(...args: Args) {
      const [source, settings, locator] = args as unknown as [SurfaceSource, ReaderSettings, string | undefined];
      engine.current?.destroy();
      const opened = createReaderEngine();
      engine.current = opened;
      if (!opened || !host.current) { void latest.current.onFailed('The reader engine is unavailable in this web view'); return; }
      opened.onLocation(location => { if (engine.current === opened) void latest.current.onLocation(location); });
      opened.onInput(input => { if (engine.current === opened) void latest.current.onInput(input); });
      const target = host.current;
      void (async () => {
        const parts: ArrayBuffer[] = [];
        for (let offset = 0; offset < source.size;) {
          const chunk = await latest.current.onChunk(offset);
          if (engine.current !== opened) return;
          // The web view decodes base64 natively through a data: URL.
          const bytes = chunk ? await (await fetch(`data:application/octet-stream;base64,${chunk}`)).arrayBuffer() : new ArrayBuffer(0);
          if (!bytes.byteLength) throw new Error(`The book ended early (${offset} of ${source.size} bytes)`);
          parts.push(bytes);
          offset += bytes.byteLength;
        }
        const url = URL.createObjectURL(new Blob(parts, { type: source.mimeType || 'application/octet-stream' }));
        try {
          const book = await opened.open({ url, format: source.format, mimeType: source.mimeType, fraction: source.fraction }, target, settings, locator);
          if (engine.current !== opened) return;
          const cover = await coverData(book.cover);
          await latest.current.onOpened({ title: book.title, author: book.author, toc: book.toc, rtl: book.rtl, ...(cover ? { cover } : {}) });
        } finally {
          URL.revokeObjectURL(url);
        }
      })().catch(reason => {
        if (engine.current === opened) void latest.current.onFailed(reason instanceof Error ? reason.message : String(reason));
      });
    },
    next() { engine.current?.next(); },
    previous() { engine.current?.previous(); },
    goTo(...args: Args) { engine.current?.goTo(String(args[0])); },
    goToFraction(...args: Args) { engine.current?.goToFraction(Number(args[0])); },
    apply(...args: Args) { engine.current?.apply(args[0] as unknown as ReaderSettings); },
  }), []);

  // After the handle above is registered, so the app's first command finds it.
  useEffect(() => {
    void latest.current.onReady();
    return () => { engine.current?.destroy(); engine.current = null; };
  }, []);

  return <div ref={host} style={{ position: 'fixed', inset: 0, overflow: 'hidden' }} />;
}
