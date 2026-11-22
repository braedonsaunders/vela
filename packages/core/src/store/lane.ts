// A lane for side reads a server may answer slowly (a library's collections): at most a few run
// at once, the rest wait their turn in order. A platform's HTTP client holds only a few
// connections to one server (four on Apple's URLSession, six in browsers, over HTTP/1.1), so
// slow reads left to pile up there would hold back Home, a library's items and every other read.

export class Lane {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  /** Reads running or waiting in this lane. */
  get size(): number { return this.running + this.waiting.length; }

  async run<T>(task: () => Promise<T>): Promise<T> {
    // A finished read hands its place straight to the next waiting one.
    if (this.running < this.limit) this.running++;
    else await new Promise<void>(resolve => this.waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}
