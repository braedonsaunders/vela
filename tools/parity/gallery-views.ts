import { LISTEN_WEB_VIEWPORTS } from './listen-views';

export const GALLERY_NOW = '2026-11-26T15:00:00.000Z';
export const GALLERY_WEB_VIEWPORTS = LISTEN_WEB_VIEWPORTS;
export const GALLERY_MOCK_ENV = {
  VELA_MOCK_NOW: GALLERY_NOW,
  VELA_MOCK_GALLERY_PARITY: '1',
  VELA_MOCK_SPORTS_FREEZE: '1',
  VELA_MOCK_SILENT_MEDIA: '1',
};

const PHOTOS = '/library/photos';
const photo = (id: string) => `/title/photo-${id}?library=photos`;

interface GalleryView {
  name: string;
  path: string;
  ready: string;
  description: string;
  document: 'home' | 'library' | 'photo';
}

export const GALLERY_VIEWS: GalleryView[] = [
  { name: 'home', path: PHOTOS, ready: 'text:Recent photos', description: 'Photos home and Recent photos row', document: 'home' },
  { name: 'all-photos', path: `${PHOTOS}?view=library`, ready: 'library-toolbar', description: 'All photos grid', document: 'library' },
  { name: 'landscape', path: photo('harbour-at-dawn'), ready: 'media-photo-page', description: 'Landscape photo with facts', document: 'photo' },
  { name: 'square', path: photo('orchard-in-fog'), ready: 'media-photo-page', description: 'Square photo with facts', document: 'photo' },
  { name: 'landscape-no-facts', path: photo('lighthouse-path'), ready: 'media-photo-page', description: 'Landscape photo without facts', document: 'photo' },
  { name: 'square-no-facts', path: photo('first-snow'), ready: 'media-photo-page', description: 'Square photo without facts', document: 'photo' },
];

export const GALLERY_REVIEWED: { viewports: RegExp; views: string[]; reason: string }[] = [];

export function galleryReviewed(view: { name: string; review?: string }, viewport: string): string | undefined {
  return GALLERY_REVIEWED.find(entry => entry.viewports.test(viewport) && entry.views.includes(view.name))?.reason ?? view.review;
}
