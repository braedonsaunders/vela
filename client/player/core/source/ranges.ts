import {DeliveryMeter} from './delivery';
import {BandwidthEstimator} from '../../abr';
import { abortable, delay } from '../async';
import type { ByteReader } from '../types';

const PAGE = 256 * 1024;
const MAX_READ = 16 * 1024 * 1024;
const CACHE = 32 * 1024 * 1024;
class RangeFailure extends Error {}
interface ReadEpoch {id:number;seen:Uint8Array|null|undefined;unique:number;repeated:number}

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
  private readEpoch:ReadEpoch={id:0,seen:undefined,unique:0,repeated:0};
  private readonly url: string;
  readonly bandwidth=new BandwidthEstimator();
  readonly delivery=new DeliveryMeter();
  readonly metrics = { requests: 0, bytes: 0, cacheHits: 0, milliseconds: 0,
    sourceEpoch:0,uniquePageRequests:0 as number|null,repeatedPageRequests:0 as number|null };
  /** A bounded bitmap counts repeat physical acquisitions without retaining URLs
   * or a list of file offsets. Old pending reads retain their requesting epoch. */
  beginEpoch(id:number){
    this.readEpoch={id,seen:undefined,unique:0,repeated:0};
    this.metrics.sourceEpoch=id;this.metrics.uniquePageRequests=0;this.metrics.repeatedPageRequests=0;
  }
  private notePage(scope:ReadEpoch,index:number,total:number){
    if(scope.seen===undefined){const length=Math.ceil(Math.ceil(total/PAGE)/8);scope.seen=length<=1024*1024?new Uint8Array(length):null;}
    if(scope.seen){const byte=index>>>3,bit=1<<(index&7);if(scope.seen[byte]&bit)scope.repeated++;else{scope.seen[byte]|=bit;scope.unique++;}}
    if(scope===this.readEpoch){this.metrics.uniquePageRequests=scope.seen?scope.unique:null;this.metrics.repeatedPageRequests=scope.seen?scope.repeated:null;}
  }
  /** Scalar metadata only, sampled by an explicit buffer-audit payload. */
  get bufferCache(){return {ranges:[...this.pages].map(([index,bytes])=>({start:index*PAGE,end:index*PAGE+bytes.length})).sort((a,b)=>a.start-b.start),
    bytes:this.cachedBytes,limit:CACHE,readAhead:0,offset:0};}

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
    const work = this.load(index,this.readEpoch).then(bytes => {
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

  private async load(index: number,scope:ReadEpoch): Promise<Uint8Array> {
    const signal = this.lifetime.signal;
    while (this.active >= 3) await abortable(new Promise<void>(resolve => this.waiters.push(resolve)),signal);
    signal.throwIfAborted(); this.active++;
    try {
      for (let attempt = 0;; attempt++) {
        signal.throwIfAborted();
        try { return await this.request(index,AbortSignal.any([signal,AbortSignal.timeout(10000)]),scope); }
        catch (error) {
          signal.throwIfAborted();
          if (error instanceof RangeFailure || attempt >= 2) throw error;
          await delay(200 * 2 ** attempt,signal);
        }
      }
    } finally { this.active--; this.waiters.shift()?.(); }
  }

  private async request(index: number, signal: AbortSignal,scope:ReadEpoch): Promise<Uint8Array> {
    const start = index * PAGE;
    const end = Math.min(start+PAGE-1,this.total === null ? Number.MAX_SAFE_INTEGER : this.total-1);
    if (end < start) throw new RangeFailure('Original page exceeds source length');
    const headers = new Headers({Range:`bytes=${start}-${end}`});
    if (this.etag && !this.etag.startsWith('W/')) headers.set('If-Range',this.etag);
    const at = performance.now(); this.metrics.requests++;
    const response = await this.fetcher(this.url,{headers,signal,credentials:'same-origin',redirect:'error'});
    const firstByte=performance.now();
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
      this.notePage(scope,index,total);
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
      this.delivery.record(at,firstByte,written);
      this.metrics.bytes += written; this.metrics.milliseconds += performance.now()-at;
      return bytes;
    } catch (error) { if (!response.body?.locked) await response.body?.cancel().catch(() => {}); throw error; }
  }

  dispose(): void {
    this.lifetime.abort(); this.pages.clear(); this.cachedBytes = 0;
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}
