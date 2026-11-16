// Work in flight on Connect: one count for every server action this screen started, so its
// controls hold still while any of them runs; a screen that unmounts drops late answers.
import { useCallback, useEffect, useRef, useState } from 'react';

export function usePending() {
  const [count, setCount] = useState(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const run = useCallback(async <T,>(work: Promise<T>): Promise<T | undefined> => {
    setCount(n => n + 1);
    try {
      const value = await work;
      return mounted.current ? value : undefined;
    } finally {
      if (mounted.current) setCount(n => n - 1);
    }
  }, []);
  return { busy: count > 0, run };
}

/** The latest answer to a question asked as the viewer types: earlier answers are dropped. */
export function useLatest<Q, A>(ask: (question: Q) => Promise<A>, delayMs: number) {
  const [answer, setAnswer] = useState<A | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { generation.current++; if (timer.current) clearTimeout(timer.current); }, []);
  const askLater = useCallback((question: Q, waiting: A | null) => {
    const mine = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    setAnswer(waiting);
    if (waiting === null) return;
    timer.current = setTimeout(() => {
      ask(question).then(
        value => { if (generation.current === mine) setAnswer(value); },
        () => { if (generation.current === mine) setAnswer(null); },
      );
    }, delayMs);
  }, [ask, delayMs]);
  return { answer, ask: askLater };
}
