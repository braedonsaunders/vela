import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { DocumentScreen } from '../../src/screen';
import { useVela } from '../../src/vela';

export default function Title() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { openTitle } = useVela();
  useEffect(() => { if (id) openTitle(id); }, [id, openTitle]);
  return <DocumentScreen route="title" entry={id ?? ''} />;
}
