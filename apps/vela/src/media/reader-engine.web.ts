// The web reader engine: foliate-js (vendored at a pinned commit, THIRD_PARTY_NOTICES) renders
// EPUB in paginated or scrolled columns and CBZ/PDF as fixed pages. Settings become the book's
// injected styles and the page geometry (reader-layout.ts); taps and keys inside the book's frames
// come back as page turns and the controls' toggle.
import type { ReaderBook, ReaderEngine, ReaderLocation, ReaderSettings, TocItem } from '@vela/skin/src/widgets/media/reader-engine';
import { READER_THEMES } from '@vela/skin/src/widgets/media/reader-engine';
import { isTap, readerLayout, safeFraction, startTarget, tapZone, type Landmark, type SectionInfo } from '@vela/skin/src/widgets/media/reader-layout';

type Input = 'next' | 'previous' | 'toggle-chrome' | 'show-chrome' | 'escape';
interface FoliateTocItem { label?: string; href?: string; subitems?: FoliateTocItem[] }
interface FoliateRenderer extends HTMLElement {
  setStyles?(css: string): void;
  render?(): void;
  next(): Promise<void>;
  prev(): Promise<void>;
  /** Paginated reflowable books: the page in view and the section's pages, counting a blank page at each end. */
  page?: number;
  pages?: number;
}
interface FoliateView extends HTMLElement {
  book: {
    metadata?: { title?: unknown; author?: unknown };
    toc?: FoliateTocItem[];
    landmarks?: Landmark[];
    dir?: string;
    sections: SectionInfo[];
    rendition?: { layout?: string };
    getCover?(): Promise<Blob | null> | Blob | null;
  };
  renderer: FoliateRenderer;
  isFixedLayout: boolean;
  open(book: Blob | File | string | object): Promise<void>;
  next(): Promise<void>; prev(): Promise<void>; goLeft(): Promise<void>; goRight(): Promise<void>;
  /** Resolves to where it went, or undefined when the target cannot be resolved (foliate logs why). */
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

/** The book's injected style: the reading theme, face, size and leading, and pictures that always
 * keep their shape. A page that is only a picture (a cover, a map, a plate) is centred on its page. */
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
    img, svg, video { max-width: 100%; }
    img[width][height] { height: auto; }
    html.vela-picture-page, html.vela-picture-page body { height: 100% !important; }
    html.vela-picture-page body { display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; padding: 0 !important; text-indent: 0 !important; }
    html.vela-picture-page body > * { margin: 0 auto !important; max-height: 100%; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    ${settings.theme === 'dark' ? 'img, svg image { filter: brightness(0.9); }' : ''}
  `;
}

/** Pictures keep their shape: a cover drawn as an SVG told to fill its box (calibre's
 * preserveAspectRatio="none") is fitted instead, and a page that is only a picture is marked so
 * its picture is centred on the page. */
export function fitPictures(doc: Document): void {
  for (const svg of Array.from(doc.querySelectorAll('svg'))) {
    if (svg.getAttribute('preserveAspectRatio')?.trim() === 'none' && svg.querySelector('image')) svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    for (const image of Array.from(svg.querySelectorAll('image'))) {
      if (image.getAttribute('preserveAspectRatio')?.trim() === 'none') image.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    }
  }
  const body = doc.body;
  if (!body) return;
  const pictures = body.querySelectorAll('img, svg, video').length;
  const words = (body.textContent ?? '').replace(/\s+/g, ' ').trim().length;
  doc.documentElement.classList.toggle('vela-picture-page', pictures >= 1 && pictures <= 2 && words < 24);
}

function quiet(work: Promise<unknown> | undefined): void {
  work?.catch(reason => console.warn('Vela reader: navigation did not complete', reason));
}

export function createReaderEngine(): ReaderEngine | null {
  if (typeof document === 'undefined' || typeof customElements === 'undefined') return null;
  let view: FoliateView | null = null;
  let host: HTMLElement | null = null;
  let settings: ReaderSettings | null = null;
  let sections = 1;
  let rtl = false;
  let cover = '';
  let resize: ResizeObserver | null = null;
  let geometry = '';
  const locations = new Set<(location: ReaderLocation) => void>();
  const inputs = new Set<(input: Input) => void>();
  const emit = (input: Input) => { for (const listener of [...inputs]) listener(input); };

  /** The page geometry for the reader's size and text size; foliate re-lays out only when it changes. */
  const layout = () => {
    if (!view?.renderer || view.isFixedLayout || !host || !settings) return;
    const bounds = host.getBoundingClientRect();
    const next = readerLayout(bounds.width, bounds.height, settings.fontSize);
    const key = `${settings.flow}|${next.columns}|${next.gap}|${next.maxInlineSize}`;
    if (key === geometry) return;
    geometry = key;
    const renderer = view.renderer;
    renderer.setAttribute('margin', '0px');
    renderer.setAttribute('max-block-size', '4000px');
    renderer.setAttribute('gap', next.gap);
    renderer.setAttribute('max-column-count', String(next.columns));
    if (renderer.getAttribute('flow') !== settings.flow) renderer.setAttribute('flow', settings.flow);
    // Setting the measure re-lays out the pages with all of the above.
    renderer.setAttribute('max-inline-size', `${next.maxInlineSize}px`);
  };

  const apply = (next: ReaderSettings) => {
    settings = next;
    if (!view?.renderer) return;
    view.renderer.setStyles?.(readerCss(next));
    layout();
  };

  /** A press that stayed put and was quick, by where it landed across the reader. Links, selections
   * and swipes (foliate turns the page itself) are not taps. Pointer events, not clicks: Safari
   * sends no click for a tap on plain text in a frame. */
  const tapper = (target: EventTarget, place: (event: PointerEvent) => number) => {
    let down: { x: number; y: number; t: number; id: number; selected: boolean } | null = null;
    target.addEventListener('pointerdown', event => {
      const e = event as PointerEvent;
      if (!e.isPrimary || e.button > 0) { down = null; return; }
      const selection = (e.target as Node | null)?.ownerDocument?.getSelection?.()?.toString() ?? '';
      down = { x: e.screenX, y: e.screenY, t: e.timeStamp, id: e.pointerId, selected: !!selection };
    });
    target.addEventListener('pointercancel', () => { down = null; });
    target.addEventListener('pointerup', event => {
      const e = event as PointerEvent;
      const start = down;
      down = null;
      if (!start || e.pointerId !== start.id || start.selected || !isTap(start, { x: e.screenX, y: e.screenY, t: e.timeStamp })) return;
      const element = e.target as Element | null;
      if (element?.closest?.('a[href], button, input, select, textarea, audio, video')) return;
      if (element?.ownerDocument?.getSelection?.()?.toString()) return;
      emit(tapZone(place(e), rtl));
    });
  };

  const share = (clientX: number) => {
    const bounds = host?.getBoundingClientRect();
    return bounds ? (clientX - bounds.left) / Math.max(1, bounds.width) : NaN;
  };

  // foliate fires `load` again when it re-lays out a page it already loaded; one set of listeners
  // per document, or every tap would toggle the controls twice.
  const attached = new WeakSet<Document>();
  const attachInput = (doc: Document) => {
    if (attached.has(doc)) return;
    attached.add(doc);
    doc.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const onLink = !!(event.target as Element | null)?.closest?.('a[href]');
      // Tab inside the book leaves it for the reader's controls.
      if (event.key === 'Tab') { event.preventDefault(); emit('show-chrome'); return; }
      // Enter (a remote's select) shows or hides the controls; on a link it follows the link.
      if (event.key === 'Enter' && !onLink) { event.preventDefault(); emit('toggle-chrome'); return; }
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) { event.preventDefault(); emit(rtl && event.key === 'ArrowRight' ? 'previous' : 'next'); }
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) { event.preventDefault(); emit(rtl && event.key === 'ArrowLeft' ? 'next' : 'previous'); }
      else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && settings?.flow !== 'scrolled') { event.preventDefault(); emit('show-chrome'); }
      else if (event.key === 'Escape') emit('escape');
    });
    // Fixed-layout pages (comics, PDF) are scaled frames, and a reflowable section's frame scrolls
    // under its column: a tap's place maps through the frame's offset and scale onto the reader.
    tapper(doc, event => {
      const element = doc.defaultView?.frameElement as HTMLElement | null | undefined;
      const frame = element?.getBoundingClientRect();
      const scale = frame && element?.offsetWidth ? frame.width / element.offsetWidth : 1;
      return share((frame?.left ?? 0) + event.clientX * scale);
    });
  };

  return {
    async open(source, target, initial, locator) {
      if (!(target instanceof HTMLElement)) throw new Error('The reader needs a page to draw in');
      host = target;
      settings ??= initial;
      await import('foliate-js/view.js');
      const response = await fetch(source.url);
      if (!response.ok) throw new Error(`The book could not be downloaded (${response.status})`);
      const blob = await response.blob();
      const extension = source.format === 'cbz' ? 'cbz' : source.format === 'pdf' ? 'pdf' : 'epub';
      const file = new File([blob], `book.${extension}`, { type: source.mimeType || blob.type });
      const opened = document.createElement('foliate-view') as FoliateView;
      view = opened;
      opened.style.cssText = 'display:block;width:100%;height:100%;';
      target.replaceChildren(opened);
      opened.addEventListener('load', event => {
        const { doc } = (event as CustomEvent<{ doc: Document }>).detail;
        if (!opened.isFixedLayout) fitPictures(doc);
        attachInput(doc);
      });
      // Taps beside the pages (a comic spread's gutter, the margins); taps inside a page's frame
      // never reach here.
      tapper(opened, event => share(event.clientX));
      opened.addEventListener('relocate', event => {
        const detail = (event as CustomEvent<{ fraction?: number; cfi?: string; tocItem?: { label?: string; href?: string }; section?: { current: number; total: number }; index?: number }>).detail;
        const index = Number.isFinite(detail.section?.current) ? detail.section!.current : Number.isFinite(detail.index) ? detail.index! : 0;
        const fixed = opened.isFixedLayout;
        // A fixed-layout book's place is its page: the first is 0%, the last 100%.
        const fraction = fixed ? (sections > 1 ? index / (sections - 1) : 0) : safeFraction(detail.fraction) ?? (sections > 1 ? index / (sections - 1) : 0);
        const renderer = opened.renderer;
        const paged = !fixed && settings?.flow !== 'scrolled' && Number.isFinite(renderer.page) && Number.isFinite(renderer.pages) && (renderer.pages ?? 0) > 2;
        const label = detail.tocItem?.label?.trim() ?? '';
        const location: ReaderLocation = {
          locator: detail.cfi || `index:${index}`,
          fraction,
          // A comic without contents names its pages by file; that is no chapter.
          chapter: FILE_NAME.test(label) ? '' : label,
          tocHref: detail.tocItem?.href,
          ...(fixed ? { page: index + 1, pages: sections } : {}),
          // Pages left only within a named chapter: front matter (a half-title, a dedication) has none.
          ...(paged && label && !FILE_NAME.test(label) ? { pagesLeft: Math.max(0, (renderer.pages! - 2) - renderer.page!) } : {}),
        };
        for (const listener of [...locations]) listener(location);
      });
      // PDFs open through a Metro-safe loader (pdf-book.web.ts); everything else foliate detects itself.
      await opened.open(source.format === 'pdf' ? await (await import('./pdf-book.web')).makePdfBook(file) as never : file);
      if (view !== opened) throw new Error('The reader closed while the book opened');
      sections = Math.max(1, opened.book.sections.length);
      rtl = opened.book.dir === 'rtl';
      apply(settings ?? initial);
      // The new geometry resizes foliate's page area, and foliate re-lays out on its own observer a
      // frame later: let that pass before the first page loads, or it lands mid-load.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      resize = new ResizeObserver(() => layout());
      resize.observe(target);
      // The book's own cover, for the opening: often sharper than the server's poster.
      try {
        const image = opened.book.getCover ? await opened.book.getCover() : null;
        if (image && image.size > 0 && view === opened) cover = URL.createObjectURL(image);
      } catch { /* The server's poster stands in. */ }
      await land(opened, locator, source.fraction);
      // A comic without metadata is titled after its file (ours is always book.<format>): no title.
      const title = text(opened.book.metadata?.title).trim();
      const book: ReaderBook = { title: /^book\.(epub|pdf|cbz)$/i.test(title) ? '' : title, author: text(opened.book.metadata?.author), toc: flatten(opened.book.toc), rtl, ...(cover ? { cover } : {}) };
      return book;
    },
    // A turn or jump that fails (a link into a missing section, a page still loading) leaves the
    // reader where it was: nothing for the viewer to act on, so it is only logged.
    next() { quiet(view?.next()); },
    previous() { quiet(view?.prev()); },
    goTo(href) { quiet(view?.goTo(href)); },
    goToFraction(fraction) { if (safeFraction(fraction) !== null) quiet(view?.goToFraction(fraction)); },
    apply,
    onLocation(listener) { locations.add(listener); return () => locations.delete(listener); },
    onInput(listener) { inputs.add(listener); return () => inputs.delete(listener); },
    destroy() {
      resize?.disconnect();
      resize = null;
      view?.close();
      view?.remove();
      view = null;
      host = null;
      geometry = '';
      if (cover) URL.revokeObjectURL(cover);
      cover = '';
    },
  };
}

/**
 * Where the book opens: exactly the saved place; a saved place this copy cannot resolve (the
 * edition changed) at its saved share of the book; otherwise the start (reader-layout.ts
 * startTarget: the title page, or the first page after the cover). foliate's own init falls back
 * to the cover when a saved place does not resolve, which is why it is not used.
 */
async function land(view: FoliateView, locator: string | undefined, fraction: number | undefined): Promise<void> {
  const start = () => startTarget(view.isFixedLayout ? [] : view.book.sections, view.isFixedLayout ? [] : view.book.landmarks);
  const go = async (target: string | number) => { try { return !!(await view.goTo(target)); } catch { return false; } };
  if (locator) {
    const saved = locator.startsWith('index:') ? Number(locator.slice(6)) : locator;
    if ((typeof saved === 'string' || Number.isFinite(saved)) && await go(saved)) return;
    console.warn('Vela reader: the saved place could not be resolved; opening at its share of the book');
    const share = safeFraction(fraction);
    if (share !== null && share > 0) {
      try { await view.goToFraction(share); return; } catch { /* The start, below. */ }
    }
  }
  if (await go(start())) return;
  if (!(await go(0))) await view.next().catch(() => undefined);
}
