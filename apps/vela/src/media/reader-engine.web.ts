// The web reader engine: foliate-js (vendored at a pinned commit, THIRD_PARTY_NOTICES) renders
// EPUB in paginated or scrolled columns and CBZ/PDF as fixed pages. Settings become the book's
// injected styles; taps and keys inside the book's frames come back as page turns.
import type { ReaderBook, ReaderEngine, ReaderLocation, ReaderSettings, TocItem } from '@vela/skin/src/widgets/media/reader-engine';
import { READER_THEMES } from '@vela/skin/src/widgets/media/reader-engine';

type Input = 'next' | 'previous' | 'toggle-chrome' | 'show-chrome' | 'escape';
interface FoliateTocItem { label?: string; href?: string; subitems?: FoliateTocItem[] }
interface FoliateView extends HTMLElement {
  book: { metadata?: { title?: unknown; author?: unknown }; toc?: FoliateTocItem[]; dir?: string; sections: unknown[]; rendition?: { layout?: string } };
  renderer: HTMLElement & { setStyles?(css: string): void; next(): Promise<void>; prev(): Promise<void> };
  isFixedLayout: boolean;
  open(book: Blob | File | string | object): Promise<void>;
  init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
  next(): Promise<void>; prev(): Promise<void>; goLeft(): Promise<void>; goRight(): Promise<void>;
  goTo(target: string | number): Promise<unknown>;
  goToFraction(fraction: number): Promise<void>;
  close(): void;
}

const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function text(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const named = value as { name?: unknown };
    if (named.name !== undefined) return text(named.name);
    return text(Object.values(value as Record<string, unknown>)[0]);
  }
  return String(value);
}

const FILE_NAME = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** The contents as rows; entries a comic names after its image files are left out. */
function flatten(items: FoliateTocItem[] | undefined, depth = 0): TocItem[] {
  return (items ?? []).flatMap(item => {
    const label = (item.label ?? '').trim();
    return [...(label && !FILE_NAME.test(label) ? [{ label, href: item.href ?? '', depth }] : []), ...flatten(item.subitems, depth + 1)];
  });
}

/** The book's injected style: the reading theme, face, size and leading. */
export function readerCss(settings: ReaderSettings): string {
  const theme = READER_THEMES[settings.theme];
  const face = settings.font === 'serif' ? SERIF : settings.font === 'sans' ? SANS : '';
  return `
    html { color-scheme: ${settings.theme === 'dark' ? 'dark' : 'light'}; color: ${theme.ink} !important; background: transparent !important; font-size: ${settings.fontSize}% !important; }
    body { color: inherit !important; background: transparent !important; }
    ${face ? `body, p, li, blockquote, dd, div, span { font-family: ${face} !important; }` : ''}
    p, li, blockquote, dd { line-height: ${settings.lineHeight} !important; text-align: justify; hyphens: auto; -webkit-hyphens: auto; widows: 2; orphans: 2; }
    [align="left"] { text-align: left; } [align="right"] { text-align: right; } [align="center"] { text-align: center; }
    a:link, a:visited { color: ${theme.link} !important; }
    pre { white-space: pre-wrap !important; }
    img, svg { max-width: 100%; }
    ${settings.theme === 'dark' ? 'img { filter: brightness(0.9); }' : ''}
  `;
}

function quiet(work: Promise<unknown> | undefined): void {
  work?.catch(reason => console.warn('Vela reader: navigation did not complete', reason));
}

export function createReaderEngine(): ReaderEngine | null {
  if (typeof document === 'undefined' || typeof customElements === 'undefined') return null;
  let view: FoliateView | null = null;
  let settings: ReaderSettings | null = null;
  let sections = 1;
  const locations = new Set<(location: ReaderLocation) => void>();
  const inputs = new Set<(input: Input) => void>();
  const emit = (input: Input) => { for (const listener of [...inputs]) listener(input); };

  const apply = (next: ReaderSettings) => {
    settings = next;
    if (!view?.renderer) return;
    if (!view.isFixedLayout) {
      view.renderer.setAttribute('flow', next.flow);
      view.renderer.setAttribute('gap', '7%');
      view.renderer.setAttribute('max-inline-size', '680px');
      view.renderer.setAttribute('max-column-count', '2');
      view.renderer.setAttribute('margin', '48px');
    }
    view.renderer.setStyles?.(readerCss(next));
  };

  /** Taps in a page's outer thirds turn it; the middle shows or hides the chrome. */
  // foliate fires `load` again when it re-lays out a page it already loaded; one set of listeners
  // per document, or every tap would toggle the chrome twice.
  const attached = new WeakSet<Document>();
  const attachInput = (doc: Document, host: HTMLElement) => {
    if (attached.has(doc)) return;
    attached.add(doc);
    doc.addEventListener('keydown', event => {
      // Tab inside the book leaves it for the reader's controls.
      if (event.key === 'Tab') { event.preventDefault(); emit('show-chrome'); return; }
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) { event.preventDefault(); emit('next'); }
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) { event.preventDefault(); emit('previous'); }
      else if (event.key === 'Escape') emit('escape');
    });
    doc.addEventListener('click', event => {
      if (event.defaultPrevented || (event.target as Element | null)?.closest?.('a[href]')) return;
      if (doc.getSelection()?.toString()) return;
      // Fixed-layout pages (comics, PDF) are scaled frames: map the tap through the frame's scale.
      const element = doc.defaultView?.frameElement as HTMLElement | null | undefined;
      const frame = element?.getBoundingClientRect();
      const scale = frame && element?.offsetWidth ? frame.width / element.offsetWidth : 1;
      const bounds = host.getBoundingClientRect();
      const x = (frame?.left ?? 0) + event.clientX * scale;
      const share = (x - bounds.left) / Math.max(1, bounds.width);
      emit(share < 0.28 ? 'previous' : share > 0.72 ? 'next' : 'toggle-chrome');
    });
  };

  return {
    async open(source, host, initial, locator) {
      if (!(host instanceof HTMLElement)) throw new Error('The reader needs a page to draw in');
      await import('foliate-js/view.js');
      const response = await fetch(source.url);
      if (!response.ok) throw new Error(`The book could not be downloaded (${response.status})`);
      const blob = await response.blob();
      const extension = source.format === 'cbz' ? 'cbz' : source.format === 'pdf' ? 'pdf' : 'epub';
      const file = new File([blob], `book.${extension}`, { type: source.mimeType || blob.type });
      view = document.createElement('foliate-view') as FoliateView;
      view.style.cssText = 'display:block;width:100%;height:100%;';
      host.replaceChildren(view);
      view.addEventListener('load', event => attachInput((event as CustomEvent<{ doc: Document }>).detail.doc, host));
      // Taps beside the pages (a comic spread's gutter, the margins) turn and show the chrome too;
      // taps inside a page's frame never reach here.
      view.addEventListener('click', event => {
        const bounds = host.getBoundingClientRect();
        const share = (event.clientX - bounds.left) / Math.max(1, bounds.width);
        emit(share < 0.28 ? 'previous' : share > 0.72 ? 'next' : 'toggle-chrome');
      });
      view.addEventListener('relocate', event => {
        const detail = (event as CustomEvent<{ fraction?: number; cfi?: string; tocItem?: { label?: string; href?: string }; location?: { current: number; total: number }; section?: { current: number; total: number }; index?: number }>).detail;
        const index = detail.section?.current ?? detail.index ?? 0;
        const fixed = view?.isFixedLayout;
        const fraction = typeof detail.fraction === 'number' ? detail.fraction : sections > 1 ? index / (sections - 1) : 0;
        const location: ReaderLocation = {
          locator: detail.cfi || `index:${index}`,
          fraction: Math.min(1, Math.max(0, fraction)),
          // A comic without contents names its pages by file; that is no chapter.
          chapter: FILE_NAME.test(detail.tocItem?.label?.trim() ?? '') ? '' : detail.tocItem?.label?.trim() ?? '',
          tocHref: detail.tocItem?.href,
          ...(fixed ? { page: index + 1, pages: sections } : detail.location ? { page: detail.location.current + 1, pages: Math.max(1, detail.location.total) } : {}),
        };
        for (const listener of [...locations]) listener(location);
      });
      // PDFs open through a Metro-safe loader (pdf-book.web.ts); everything else foliate detects itself.
      await view.open(source.format === 'pdf' ? await (await import('./pdf-book.web')).makePdfBook(file) as never : file);
      sections = Math.max(1, view.book.sections.length);
      apply(settings ?? initial);
      // A saved place this copy of the book cannot resolve (an edition changed) falls back to the
      // saved share of the book, then to the start of the text.
      try {
        if (locator?.startsWith('index:')) { await view.init({ showTextStart: true }); await view.goTo(Number(locator.slice(6)) || 0); }
        else await view.init({ lastLocation: locator, showTextStart: !locator });
      } catch (reason) {
        console.warn('Vela reader: the saved place could not be resolved; opening at its share of the book', reason);
        if (source.fraction && source.fraction > 0) await view.goToFraction(source.fraction).catch(() => view?.init({ showTextStart: true }));
        else await view.init({ showTextStart: true }).catch(() => undefined);
      }
      const book: ReaderBook = { title: text(view.book.metadata?.title), author: text(view.book.metadata?.author), toc: flatten(view.book.toc), rtl: view.book.dir === 'rtl' };
      return book;
    },
    // A turn or jump that fails (a link into a missing section, a page still loading) leaves the
    // reader where it was: nothing for the viewer to act on, so it is only logged.
    next() { quiet(view?.next()); },
    previous() { quiet(view?.prev()); },
    goTo(href) { quiet(view?.goTo(href)); },
    goToFraction(fraction) { quiet(view?.goToFraction(fraction)); },
    apply,
    onLocation(listener) { locations.add(listener); return () => locations.delete(listener); },
    onInput(listener) { inputs.add(listener); return () => inputs.delete(listener); },
    destroy() { view?.close(); view?.remove(); view = null; },
  };
}
