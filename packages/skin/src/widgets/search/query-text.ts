// The text in a search field, held by the field itself and reported to the store, rather than
// read back from the store's query on every keystroke. A field controlled by env.query drops
// characters typed in a burst (a paste, voice input, a fast typist on Android TV): the first one
// opens search, the page re-renders, and the later ones reach an input whose value prop still
// holds the first, which resets them. The field follows the store only when the query changes
// from elsewhere (cleared, or set by another field).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHost } from '../../host';

export function useQueryText(): { text: string; change(text: string): void } {
  const host = useHost();
  const query = host.env.query;
  const [text, setText] = useState(query);
  // What this field has sent and the store has not echoed yet, oldest first. The store may echo
  // a burst late and one value at a time; any of them is this field's own, not a change.
  const pending = useRef<string[]>([]);

  useEffect(() => {
    const echoed = pending.current.indexOf(query);
    if (echoed >= 0) {
      pending.current = pending.current.slice(echoed + 1);
      return;
    }
    pending.current = [];
    setText(query);
  }, [query]);

  const { setQuery } = host;
  const change = useCallback(
    (next: string) => {
      pending.current.push(next);
      setText(next);
      setQuery(next);
    },
    [setQuery],
  );
  return { text, change };
}
