import { LISTEN_WEB_VIEWPORTS, type Step } from './listen-views';

export const READ_NOW = '2026-11-26T15:00:00.000Z';
export const READ_WEB_VIEWPORTS = LISTEN_WEB_VIEWPORTS;
export const READ_MOCK_ENV = {
  VELA_MOCK_NOW: READ_NOW,
  VELA_MOCK_READ_FREEZE: '1',
  VELA_MOCK_SPORTS_FREEZE: '1',
  VELA_MOCK_SILENT_MEDIA: '1',
};

interface ReadView {
  name: string;
  path: string;
  description: string;
  ready: string;
  steps?: Step[];
  settled?: string;
  only?: string[];
}

const BOOKS = '/library/books';
const book = (id: string) => `/title/book-${id}?library=books`;
const reader = (id: string) => `/read/book-${id}?library=books`;
const READER_VIEWPORTS = [...READ_WEB_VIEWPORTS.map(viewport => viewport.name), 'ios-phone', 'ios-fold'];

export const READ_VIEWS: ReadView[] = [
  { name: 'home', path: BOOKS, ready: 'text:Continue reading', description: 'Books Home and Continue reading' },
  { name: 'library', path: `${BOOKS}?view=library`, ready: 'library-toolbar', description: 'Combined Books library and filters' },
  { name: 'authors', path: `${BOOKS}?view=authors`, ready: 'text:Ione Ashcombe', description: 'Authors tab' },
  { name: 'all-books', path: `${BOOKS}?view=all-books`, ready: 'text:A Harbour of Bells', description: 'All books tab' },
  { name: 'all-series', path: `${BOOKS}?view=series`, ready: 'text:The Saltglass Chronicles', description: 'Series tab' },
  { name: 'book', path: book('harbour-of-bells'), ready: 'media-reading-progress', description: 'Book in a series with saved progress. TV shows the read-elsewhere message.' },
  { name: 'standalone', path: book('patient-garden'), ready: 'media-byline', description: 'Standalone unread book' },
  { name: 'series', path: '/title/series-saltglass-chronicles?library=books', ready: 'media-book-book-harbour-of-bells',
    description: 'Series page and ordered volumes' },
  { name: 'reader-epub', path: reader('harbour-of-bells'), ready: 'reader-hint', description: 'Resumed EPUB with chrome hidden', only: READER_VIEWPORTS },
  { name: 'reader-contents', path: reader('harbour-of-bells'), ready: 'reader-hint',
    steps: [{ press: 'Enter' }, { click: 'reader-contents' }], settled: 'text:Contents', description: 'EPUB contents drawer', only: READER_VIEWPORTS },
  { name: 'reader-appearance', path: reader('harbour-of-bells'), ready: 'reader-hint',
    steps: [{ press: 'Enter' }, { click: 'reader-type' }], settled: 'text:Text and layout', description: 'EPUB appearance drawer', only: READER_VIEWPORTS },
  { name: 'reader-pdf', path: reader('field-guide-imaginary-birds'), ready: 'reader-hint', description: 'PDF with chrome hidden', only: READER_VIEWPORTS },
  { name: 'reader-comic', path: reader('captain-pebble'), ready: 'reader-hint', description: 'Comic with chrome hidden', only: READER_VIEWPORTS },
];

export const READ_REVIEWED: { viewports: RegExp; views: string[]; reason: string }[] = [];

export function readReviewed(view: { name: string; review?: string }, viewport: string): string | undefined {
  return READ_REVIEWED.find(review => review.viewports.test(viewport) && review.views.includes(view.name))?.reason ?? view.review;
}
