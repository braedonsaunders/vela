// Server-sent events over fetch: the browser's streaming body on the web, expo/fetch natively
// (Expo installs it as the global fetch). One reader per connection; the caller owns retries.

/** One dispatched event. `id` is the server's cursor, when it sent one. */
export interface StreamEvent {
  event: string;
  id: string;
  data: string;
}

export type EventHandler = (event: StreamEvent) => void | Promise<void>;

/** Read a `text/event-stream` body to its end, handing each event to `onEvent` in order. */
export async function readEvents(response: Response, onEvent: EventHandler, signal?: AbortSignal): Promise<void> {
  if (!response.body) throw new Error('This platform cannot stream server events');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new EventParser();
  const abort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        signal?.throwIfAborted();
        await onEvent(event);
      }
    }
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

/** The event-stream line format: `field: value` lines, a blank line dispatching the event. */
class EventParser {
  private buffer = '';
  private data: string[] = [];
  private event = '';
  private id = '';

  push(text: string): StreamEvent[] {
    this.buffer += text;
    // A trailing '\r' may be the first half of '\r\n' split across chunks: hold it back.
    const held = this.buffer.endsWith('\r') ? '\r' : '';
    const lines = this.buffer.slice(0, this.buffer.length - held.length).split(/\r\n|\r|\n/);
    // The last piece is a partial line until its terminator arrives.
    this.buffer = (lines.pop() ?? '') + held;
    const events: StreamEvent[] = [];
    for (const line of lines) {
      const event = this.line(line);
      if (event) events.push(event);
    }
    return events;
  }

  private line(line: string): StreamEvent | undefined {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
    else if (field === 'id' && !value.includes('\0')) this.id = value;
    return undefined;
  }

  private dispatch(): StreamEvent | undefined {
    const data = this.data;
    const event = this.event || 'message';
    this.data = [];
    this.event = '';
    return data.length ? { event, id: this.id, data: data.join('\n') } : undefined;
  }
}
