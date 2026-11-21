// The reader's engine boundary (docs/media-kinds.md): what the reader page asks of whatever
// renders the book (foliate-js on the web; the same engine in a DOM component on devices).

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type ReaderFont = 'serif' | 'sans' | 'publisher';
export type ReaderFlow = 'paginated' | 'scrolled';

export interface ReaderSettings {
  theme: ReaderTheme;
  font: ReaderFont;
  /** Text size, percent of the book's own (100 = as published). */
  fontSize: number;
  lineHeight: number;
  flow: ReaderFlow;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = { theme: 'light', font: 'serif', fontSize: 100, lineHeight: 1.5, flow: 'paginated' };

export const READER_THEMES: Record<ReaderTheme, { page: string; ink: string; quiet: string; rule: string; link: string }> = {
  light: { page: '#fbf9f4', ink: '#1f1d1a', quiet: '#7a756c', rule: '#e6e0d4', link: '#7a4b1f' },
  sepia: { page: '#f3ead8', ink: '#4b3a2a', quiet: '#8a7660', rule: '#e0d3b8', link: '#8a4b16' },
  dark: { page: '#141416', ink: '#d9d4ca', quiet: '#8b8780', rule: '#2a2a2e', link: '#e0b88a' },
};

export interface TocItem { label: string; href: string; depth: number }

export interface ReaderLocation {
  /** Opaque to the server: the engine's locator (an EPUB CFI, a page). */
  locator: string;
  /** 0..1 through the whole book. */
  fraction: number;
  /** The chapter the page is in. */
  chapter: string;
  /** Page within the book when the engine knows it (1-based), and the total. */
  page?: number;
  pages?: number;
  /** The current TOC entry's href, to mark it in the contents. */
  tocHref?: string;
}

export interface ReaderBook { title: string; author: string; toc: TocItem[]; rtl: boolean }

export interface ReaderEngine {
  /** Open the document into `host` (a DOM element on the web) at a saved locator. */
  open(source: { url: string; format: 'epub' | 'pdf' | 'cbz'; mimeType: string; /** The saved share of the book, when the locator cannot be resolved. */ fraction?: number }, host: unknown, settings: ReaderSettings, locator?: string): Promise<ReaderBook>;
  next(): void;
  previous(): void;
  goTo(href: string): void;
  goToFraction(fraction: number): void;
  apply(settings: ReaderSettings): void;
  onLocation(listener: (location: ReaderLocation) => void): () => void;
  /** Taps, clicks and keys inside the book's frame, which the page cannot see itself. */
  onInput(listener: (input: 'next' | 'previous' | 'toggle-chrome' | 'escape') => void): () => void;
  destroy(): void;
}
