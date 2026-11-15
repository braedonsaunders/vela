import {BandwidthEstimator} from '../../abr';
import { abortable, delay } from '../async';
import type { ByteReader } from '../types';

const PAGE = 256 * 1024;
const MAX_READ = 16 * 1024 * 1024;
const CACHE = 32 * 1024 * 1024;
class RangeFailure extends Error {}

/** One pinned original, shared by AV and subtitles. No whole-file fallback. */
export class RangeReader implements ByteReader {
  private readonly lifetime = new AbortController();
  private readonly pages = new Map<number, Uint8Array>();
  private readonly pending = new Map<number, Promise<Uint8Array>>();
  private readonly waiters: (() => void)[] = [];
  private active = 0;
  private cachedBytes = 0;
  private total: number | null = null;
  private etag: string | null = null;
  private modified: string | null = null;
  private hasRevision = false;
  private readonly url: string;
  readonly bandwidth=new BandwidthEstimator();
  readonly metrics = { requests: 0, bytes: 0, cacheHits: 0, milliseconds: 0 };

  constructor(url: string, private readonly fetcher: typeof fetch = (...args) => fetch(...args),allowed?:(url:URL)=>boolean) {
    const parsed = new URL(url, document.baseURI);
    if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password || (allowed?!allowed(parsed):parsed.origin !== location.origin))
      throw new RangeFailure('Original source must be a same-origin scoped HTTP URL');
    this.url = parsed.href;
  }

  async size(signal: AbortSignal): Promise<number> {
    signal.throwIfAborted(); this.lifetime.signal.throwIfAborted();
    if (this.total === null) await abortable(this.page(0), signal);
    return this.total!;
  }

  async read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted(); this.lifetime.signal.throwIfAborted();
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 ||
        length > MAX_READ || !Number.isSafeInteger(offset + length)) throw new RangeFailure('Invalid or oversized original read');
    const total = await this.size(signal);
    if (offset + length > total) throw new RangeFailure('Original read exceeds pinned source length');
    const output = new Uint8Array(length);
    // Limit fanout as well as network concurrency. A seek never queues a remux.
    for (let cursor = offset; cursor < offset + length;) {
      signal.throwIfAborted();
      const first = Math.floor(cursor / PAGE);
      const count = Math.min(3, Math.ceil((offset + length) / PAGE) - first);
      const pages = await abortable(Promise.all(Array.from({length:count},(_,i) => this.page(first+i))), signal);
      signal.throwIfAborted();
      for (let index = 0; index < pages.length; index++) {
        const start = (first + index) * PAGE;
        const from = Math.max(cursor,start), end = Math.min(offset+length,start+pages[index].length);
        output.set(pages[index].subarray(from-start,end-start),from-offset);
        cursor = end;
      }
    }
    return output;
  }

  private page(index: number): Promise<Uint8Array> {
    this.lifetime.signal.throwIfAborted();
    const cached = this.pages.get(index);
    if (cached) { this.pages.delete(index); this.pages.set(index,cached); this.metrics.cacheHits++; return Promise.resolve(cached); }
    const pending = this.pending.get(index); if (pending) return pending;
    const work = this.load(index).then(bytes => {
      this.lifetime.signal.throwIfAborted();
      this.pages.set(index,bytes); this.cachedBytes += bytes.length;
      while (this.cachedBytes > CACHE) {
        const oldest = this.pages.keys().next().value!;
        this.cachedBytes -= this.pages.get(oldest)!.length; this.pages.delete(oldest);
      }
      return bytes;
    }).finally(() => this.pending.delete(index));
    this.pending.set(index,work); return work;
  }

  private async load(index: number): Promise<Uint8Array> {
    const signal = this.lifetime.signal;
    while (this.active >= 3) await abortable(new Promise<void>(resolve => this.waiters.push(resolve)),signal);
    signal.throwIfAborted(); this.active++;
    try {
      for (let attempt = 0;; attempt++) {
        signal.throwIfAborted();
        try { return await this.request(index,AbortSignal.any([signal,AbortSignal.timeout(10000)])); }
        catch (error) {
          signal.throwIfAborted();
          if (error instanceof RangeFailure || attempt >= 2) throw error;
          await delay(200 * 2 ** attempt,signal);
        }
      }
    } finally { this.active--; this.waiters.shift()?.(); }
  }

  private async request(index: number, signal: AbortSignal): Promise<Uint8Array> {
    const start = index * PAGE;
    const end = Math.min(start+PAGE-1,this.total === null ? Number.MAX_SAFE_INTEGER : this.total-1);
    if (end < start) throw new RangeFailure('Original page exceeds source length');
    const headers = new Headers({Range:`bytes=${start}-${end}`});
    if (this.etag && !this.etag.startsWith('W/')) headers.set('If-Range',this.etag);
    const at = performance.now(); this.metrics.requests++;
    const response = await this.fetcher(this.url,{headers,signal,credentials:'same-origin',redirect:'error'});
    try {
      if (response.status !== 206) {
        if (response.status === 408 || response.status === 429 || response.status >= 500) throw new TypeError(`Original range HTTP ${response.status}`);
        throw new RangeFailure(`Original range requires206, received${response.status}`);
      }
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
      const first = Number(range?.[1]), last = Number(range?.[2]), total = Number(range?.[3]);
      if (!range || ![first,last,total].every(Number.isSafeInteger) || total <= 0 || first !== start ||
          last !== Math.min(end,total-1) || last < first || total <= last || this.total !== null && total !== this.total)
        throw new RangeFailure('Original range response changed or does not match request');
      const etag = response.headers.get('ETag'), modified = response.headers.get('Last-Modified');
      if (this.hasRevision && (this.etag !== etag || this.modified !== modified)) throw new RangeFailure('Original revision changed');
      this.total = total; this.etag = etag; this.modified = modified; this.hasRevision = true;
      const expected = last-first+1;
      const body = response.body?.getReader(); if (!body) throw new RangeFailure('Original range response has no body');
      const bytes = new Uint8Array(expected); let written = 0;
      try {
        for (;;) {
          const {done,value} = await body.read(); if (done) break;
          if (written+value.length > expected) throw new RangeFailure('Original range body exceeds declared length');
          bytes.set(value,written); written += value.length;
        }
      } finally { if (written !== expected) await body.cancel().catch(() => {}); body.releaseLock(); }
      if (written !== expected) throw new TypeError('Original range body was truncated');
      this.bandwidth.sample(written,performance.now()-at,Number(response.headers.get('Age')??0)>0||/hit/i.test(response.headers.get('X-Cache')??''));
      this.metrics.bytes += written; this.metrics.milliseconds += performance.now()-at;
      return bytes;
    } catch (error) { if (!response.body?.locked) await response.body?.cancel().catch(() => {}); throw error; }
  }

  dispose(): void {
    this.lifetime.abort(); this.pages.clear(); this.cachedBytes = 0;
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}
