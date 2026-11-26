// A PDF as a foliate-js book, for the web reader. Adapted from foliate-js's pdf.js (MIT, John
// Factotum; THIRD_PARTY_NOTICES) without its top-level await, which Metro cannot bundle: PDF.js
// (vendored by foliate-js, Apache-2.0) loads only when a PDF opens, runs its worker on the main
// thread, and each page is drawn to a canvas at the reader's zoom.

import { installPdfBuiltins } from './pdf-builtins';

interface PdfPage { getViewport(options: { scale: number }): { width: number; height: number }; render(options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> } }
interface PdfOutline { title: string; dest: unknown; items: PdfOutline[] }
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  getMetadata(): Promise<{ info?: { Title?: string; Author?: string }; metadata?: { get(key: string): string | undefined } } | null>;
  getOutline(): Promise<PdfOutline[] | null>;
  getDestination(name: string): Promise<unknown[]>;
  getPageIndex(ref: unknown): Promise<number>;
  destroy(): void;
}
interface PdfJs {
  PDFDataRangeTransport: new (length: number, initial: unknown[]) => { requestDataRange?: (begin: number, end: number) => void; onDataRange(begin: number, chunk: ArrayBuffer): void };
  getDocument(options: object): { promise: Promise<PdfDocument> };
}

async function pdfjs(): Promise<PdfJs> {
  installPdfBuiltins();
  // The worker module registers itself as globalThis.pdfjsWorker, which PDF.js then runs in-page.
  await import('foliate-js/vendor/pdfjs/pdf.worker.mjs');
  await import('foliate-js/vendor/pdfjs/pdf.mjs');
  return (globalThis as unknown as { pdfjsLib: PdfJs }).pdfjsLib;
}

async function render(page: PdfPage, doc: Document, zoom: number): Promise<void> {
  const scale = zoom * devicePixelRatio;
  doc.documentElement.style.transform = `scale(${1 / devicePixelRatio})`;
  doc.documentElement.style.transformOrigin = 'top left';
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  await page.render({ canvasContext: context, viewport }).promise;
  doc.querySelector('#canvas')?.replaceChildren(doc.adoptNode(canvas));
}

function pageFrame(page: PdfPage) {
  const viewport = page.getViewport({ scale: 1 });
  const src = URL.createObjectURL(new Blob([`<!DOCTYPE html><html lang="en"><meta charset="utf-8">
    <meta name="viewport" content="width=${viewport.width}, height=${viewport.height}">
    <style>html, body { margin: 0; padding: 0; }</style><div id="canvas"></div>`], { type: 'text/html' }));
  return { src, onZoom: ({ doc, scale }: { doc: Document; scale: number }) => render(page, doc, scale) };
}

const tocItem = (item: PdfOutline): object => ({ label: item.title, href: JSON.stringify(item.dest), subitems: item.items.length ? item.items.map(tocItem) : null });

export async function makePdfBook(file: Blob): Promise<object> {
  const lib = await pdfjs();
  const transport = new lib.PDFDataRangeTransport(file.size, []);
  transport.requestDataRange = (begin, end) => { void file.slice(begin, end).arrayBuffer().then(chunk => transport.onDataRange(begin, chunk)); };
  const pdf = await lib.getDocument({ range: transport, isEvalSupported: false }).promise;
  const { metadata, info } = await pdf.getMetadata() ?? {};
  const pageOf = async (href: string) => {
    const parsed = JSON.parse(href) as string | unknown[];
    const dest = typeof parsed === 'string' ? await pdf.getDestination(parsed) : parsed;
    return pdf.getPageIndex(dest[0]);
  };
  const cache = new Map<number, ReturnType<typeof pageFrame>>();
  return {
    rendition: { layout: 'pre-paginated' },
    metadata: { title: metadata?.get('dc:title') ?? info?.Title, author: metadata?.get('dc:creator') ?? info?.Author },
    toc: (await pdf.getOutline())?.map(tocItem),
    sections: Array.from({ length: pdf.numPages }, (_, i) => ({
      id: i,
      size: 1000,
      load: async () => {
        const cached = cache.get(i);
        if (cached) return cached;
        const frame = pageFrame(await pdf.getPage(i + 1));
        cache.set(i, frame);
        return frame;
      },
    })),
    isExternal: (uri: string) => /^\w+:/i.test(uri),
    resolveHref: async (href: string) => ({ index: await pageOf(href) }),
    splitTOCHref: async (href: string) => [await pageOf(href), null],
    getTOCFragment: (doc: Document) => doc.documentElement,
    destroy: () => pdf.destroy(),
  };
}
