// The store's state: one immutable snapshot, replaced slice by slice. React reads it through
// useSyncExternalStore (`@vela/core/react`); each slice keeps its identity until it changes, so a
// selector that returns a slice re-renders only when that slice does.
export type Load = 'idle' | 'loading' | 'ready' | 'failed';

/** A value read from the server: its load state, the value once read, and why it failed. */
export interface Loadable<T> {
  load: Load;
  value?: T;
  error: string;
}

export const idle = <T>(): Loadable<T> => ({ load: 'idle', error: '' });
export const loading = <T>(previous?: Loadable<T>): Loadable<T> => ({ load: 'loading', value: previous?.value, error: '' });
export const ready = <T>(value: T): Loadable<T> => ({ load: 'ready', value, error: '' });
export const failed = <T>(error: unknown, previous?: Loadable<T>): Loadable<T> => ({
  load: 'failed',
  value: previous?.value,
  error: message(error),
});

export function message(error: unknown, fallback = 'Something went wrong'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

type Listener = () => void;

/** Holds one state object and tells subscribers when it is replaced. */
export class StateBox<S extends object> {
  private listeners = new Set<Listener>();

  constructor(private state: S) {}

  get = (): S => this.state;

  /** Replace a coherently updated snapshot and announce it once. */
  replace(next: S): void {
    if (next === this.state) return;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Replace one slice. Nothing is announced when the slice comes back unchanged. */
  update<K extends keyof S>(key: K, change: (slice: S[K]) => S[K]): void {
    const next = change(this.state[key]);
    if (next === this.state[key]) return;
    this.state = { ...this.state, [key]: next };
    for (const listener of [...this.listeners]) listener();
  }
}
