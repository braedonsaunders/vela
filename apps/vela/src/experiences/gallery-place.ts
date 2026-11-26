import type { ExperiencePlace } from '@vela/skin/src/screen/experience-route';

export const TIMELINE_PLACE: ExperiencePlace = { page: 'timeline', params: {} };

export function galleryPlace(place: ExperiencePlace): ExperiencePlace {
  if (place.page === 'albums' || place.page === 'people') return { page: place.page, params: {} };
  if ((place.page === 'album' || place.page === 'person') && place.params.id) {
    const { id, name } = place.params;
    return { page: place.page, params: { id, ...(name ? { name } : {}) } };
  }
  return TIMELINE_PLACE;
}

export function galleryTab(page: string): 'timeline' | 'albums' | 'people' {
  if (page === 'album' || page === 'albums') return 'albums';
  if (page === 'person' || page === 'people') return 'people';
  return 'timeline';
}

export function hasGalleryEntries(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'items' in value && Array.isArray(value.items) && value.items.length > 0;
}
