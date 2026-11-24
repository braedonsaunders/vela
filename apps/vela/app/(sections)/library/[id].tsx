// A library page: the library's experience (watch, listen, read, gallery, live) over one library,
// its place held in the URL (`?sort=&dir=&kind=&genre=&year=&played=&fav=`, the audio app's `?m=`).
import { useLocalSearchParams } from 'expo-router';
import type { LibraryParams } from '../../../src/browse/library-query';
import { EXPERIENCE_SECTIONS, useLibraryExperience } from '../../../src/experiences';

export default function Library() {
  const params = useLocalSearchParams<LibraryParams & { id: string }>();
  return <LibrarySection id={params.id ?? ''} params={params} />;
}

/** A retained section has a stable identity independent of the navigator's route key. */
export function LibrarySection({ id, params }: { id: string; params: LibraryParams & { m?: string } }) {
  const Section = EXPERIENCE_SECTIONS[useLibraryExperience(id)];
  return <Section id={id} params={params} />;
}
