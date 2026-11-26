import { mediaGroups, mediaLibraries } from '../packages/protocol/fixtures/media';

/** Use the original catalogue while exercising both image shapes and optional facts. */
export function seedGalleryParity(includeRecommendations: boolean): void {
  for (const title of mediaGroups.photos) {
    if (title.id === 'photo-orchard-in-fog' || title.id === 'photo-first-snow') {
      title.artwork = title.artwork.filter(art => art.kind === 'poster');
    }
    if (title.media && (title.id === 'photo-lighthouse-path' || title.id === 'photo-first-snow')) {
      delete title.media.facts;
    }
  }
  if (includeRecommendations) {
    const library = mediaLibraries.find(entry => entry.id === 'photos');
    if (library) library.tabs = [{ id: 'recommended', label: 'Recommendations', kind: 'recommended' }, ...(library.tabs ?? [])];
  }
}
