// Apple TV search's pure rules: when typed text becomes the store's query, and when Return moves
// focus into the results.

/** How long typing pauses before its text is searched. Return searches at once. */
export const LIVE_SEARCH_DELAY_MS = 250;

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const defaultTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface LiveQuery {
  /** The field's text changed (typing, dictation, the iPhone keyboard). */
  change(text: string): void;
  /** Return: search this text now. */
  submit(text: string): void;
  /** The screen closed: nothing pending is searched. */
  cancel(): void;
}

/** Searches the field's text once typing pauses, at once on Return, and clears at once when the
 * field is emptied. The same text is never searched twice in a row: each search restarts every
 * lane, and Return after the pause already searched would only flash the results. */
export function liveQuery(commit: (text: string) => void, delay = LIVE_SEARCH_DELAY_MS, timers: Timers = defaultTimers): LiveQuery {
  let pending: unknown;
  let searched: string | undefined;
  const stop = () => {
    if (pending !== undefined) timers.clear(pending);
    pending = undefined;
  };
  const search = (text: string) => {
    stop();
    if (text === searched) return;
    searched = text;
    commit(text);
  };
  return {
    change(text) {
      stop();
      if (text.trim() === '') search(text);
      else pending = timers.set(() => search(text), delay);
    },
    submit: search,
    cancel: stop,
  };
}

/** What the results hold for focus to land on. */
export interface ResultsView {
  query: string;
  titles: { state: 'loading' | 'failed' | 'ready'; items: unknown[]; channels: unknown[]; programmes: unknown[] };
  descriptive: { items: unknown[] };
}

/** After Return: `wait` while the titles for the submitted text are still coming, `focus` once
 * there is something to move to, `drop` when nothing came back or the viewer typed on (focus
 * stays on the keyboard). */
export function resultsFocus(submitted: string, view: ResultsView | undefined): 'wait' | 'focus' | 'drop' {
  if (submitted.trim() === '' || !view || view.query !== submitted) return 'drop';
  if (view.titles.state === 'loading') return 'wait';
  const { items, channels, programmes } = view.titles;
  return items.length + channels.length + programmes.length + view.descriptive.items.length > 0 ? 'focus' : 'drop';
}
