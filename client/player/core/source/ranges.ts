import {DeliveryMeter} from './delivery';
import {BandwidthEstimator} from '../../abr';
import { abortable, delay } from '../async';
import type { ByteReader } from '../types';

const PAGE = 256 * 1024;
const MAX_READ = 16 * 1024 * 1024;
const CACHE = 32 * 1024 * 1024;
const MIB=1024*1024,WINDOW=64*MIB;
class RangeFailure extends Error {}
class RangePreempt extends Error {}
interface ReadEpoch {id:number;seen:Uint8Array|null|undefined;unique:number;repeated:number}
interface PageSlot {promise:Promise<Uint8Array>;resolve(bytes:Uint8Array):void;reject(error:unknown):void}
interface ForwardRun {
  end:number;next:number;demand:number;scope:ReadEpoch;
  abort:AbortController;signal:AbortSignal;slots:Map<number,PageSlot>;
  request?:AbortController;
}

/** One pinned original, shared by AV and subtitles. Media runs use streamed
 * 64-MiB windows; metadata stays random-access. Five seconds of byte reserve
 * (8–64 MiB) and a 32–128 MiB LRU bound read-ahead without a second cache. */
export class RangeReader implements ByteReader {
  private readonly lifetime = new AbortController();
  private readonly pages = new Map<number, Uint8Array>();
  private readonly pending = new Map<number, Promise<Uint8Array>>();
  private readonly slotWaiters=new Set<()=>void>();
  private active = 0;
  private cachedBytes = 0;
  private cacheLimit=CACHE;
  private ahead=8*MIB;
  private forward?:ForwardRun;
  private forwardSignal?:AbortSignal;
  private forwardAnchor=0;
  private forwardDemand=0;
  private readonly forwardRuns=new Set<ForwardRun>();
  private readonly progressWaiters=new Set<()=>void>();
  private readonly demands:{offset:number;length:number}[]=[];
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
    for(const run of this.forwardRuns)this.cancelForward(run);
    this.forward=undefined;this.forwardSignal=undefined;this.forwardDemand=0;
    this.demands.length=0;
    this.readEpoch={id,seen:undefined,unique:0,repeated:0};
    this.metrics.sourceEpoch=id;this.metrics.uniquePageRequests=0;this.metrics.repeatedPageRequests=0;
  }
  configureBuffer(durationSeconds:number|null){
    const rate=this.total!==null&&durationSeconds!==null&&Number.isFinite(durationSeconds)&&durationSeconds>0?this.total/durationSeconds:null;
    this.ahead=Math.ceil(rate===null?8*MIB:Math.max(8*MIB,Math.min(64*MIB,rate*5)));
    this.cacheLimit=Math.max(CACHE,Math.min(128*MIB,this.ahead*2));
    this.trim();this.wakeProgress();
  }
  prefetch(offset:number,signal:AbortSignal){
    signal.throwIfAborted();this.lifetime.signal.throwIfAborted();
    if(this.total===null||!Number.isSafeInteger(offset)||offset<0||offset>=this.total)return;
    if(!this.forwardSignal){this.forwardSignal=signal;this.forwardAnchor=offset;this.forwardDemand=offset;}
    this.forwardAnchor=Math.min(this.forwardAnchor,offset);
    this.maintainForward(offset,offset,true);
  }
  private maintainForward(offset:number,end:number,foreground=false){
    const signal=this.forwardSignal,previous=this.forward;
    if(!signal||signal.aborted||this.total===null||offset<this.forwardAnchor)return;
    // Random indexes do not retarget the established media run.
    if(!foreground&&previous&&offset>previous.end+MAX_READ)return;
    this.forwardDemand=Math.max(this.forwardDemand,end);
    for(const run of this.forwardRuns)run.demand=this.forwardDemand;
    this.wakeProgress();
    const wanted=Math.min(this.total,this.forwardDemand+this.ahead);
    let index=Math.floor(offset/PAGE);
    // Cached metadata islands split a run into disjoint ranges. Fill their
    // gaps concurrently rather than paying another RTT after every island.
    while(index*PAGE<wanted){
      if(this.pages.has(index)||this.pending.has(index)){index++;continue;}
      if(this.forwardRuns.size>=3&&!foreground)return;
      const start=index*PAGE;
      let limit=Math.min(start+WINDOW,this.total);
      for(const at of [...this.pages.keys(),...this.pending.keys()])if(at>index&&at*PAGE<limit)limit=at*PAGE;
      this.startForward(start,limit,signal);index=Math.ceil(limit/PAGE);
      // One explicit media hint may add a demanded run even while three
      // background plans exist; it does not plan an unlimited future tail.
      foreground=false;
    }
  }
  private startForward(start:number,limit:number,signal:AbortSignal){
    const abort=new AbortController();
    const run:ForwardRun={end:limit,next:start,demand:this.forwardDemand,scope:this.readEpoch,
      abort,signal:AbortSignal.any([signal,this.lifetime.signal,abort.signal]),slots:new Map()};
    for(let at=start;at<limit;at+=PAGE){
      let resolve!:(bytes:Uint8Array)=>void,reject!:(error:unknown)=>void;
      const promise=new Promise<Uint8Array>((yes,no)=>{resolve=yes;reject=no;});
      void promise.catch(()=>{});const slot={promise,resolve,reject};run.slots.set(at/PAGE,slot);this.pending.set(at/PAGE,promise);
    }
    this.forward=run;this.forwardRuns.add(run);
    void this.loadForward(run).catch(error=>{this.rejectForward(run,error);if(error instanceof RangeFailure&&!run.signal.aborted)this.lifetime.abort(error);}).finally(()=>{
      this.forwardRuns.delete(run);this.wakeProgress();
    });
  }
  private rejectForward(run:ForwardRun,error:unknown){
    for(const [index,slot]of run.slots){if(this.pending.get(index)===slot.promise)this.pending.delete(index);slot.reject(error);}run.slots.clear();
  }
  private cancelForward(run:ForwardRun){
    const error=new DOMException('Forward source epoch retired','AbortError');
    this.rejectForward(run,error);run.abort.abort(error);this.wakeProgress();
  }
  /** A pending page is a promise, not permission for read-ahead to make a
   * foreground decoder wait for megabytes it did not ask to consume. Transfer
   * its unchanged promises to a tail run and cancel only the in-flight body. */
  private prioritize(index:number){
    for(const run of this.forwardRuns){
      const cut=index*PAGE;
      if(!run.slots.has(index))continue;
      if(cut<=run.next+PAGE)return;
      const abort=new AbortController(),tail:ForwardRun={end:run.end,next:cut,demand:this.forwardDemand,scope:run.scope,
        abort,signal:AbortSignal.any([this.forwardSignal!,this.lifetime.signal,abort.signal]),slots:new Map()};
      for(const [at,slot]of run.slots)if(at>=index){tail.slots.set(at,slot);run.slots.delete(at);}
      run.end=cut;this.forward=tail;this.forwardRuns.add(tail);
      void this.loadForward(tail).catch(error=>{this.rejectForward(tail,error);if(error instanceof RangeFailure&&!tail.signal.aborted)this.lifetime.abort(error);})
        .finally(()=>{this.forwardRuns.delete(tail);this.wakeProgress();});
      run.request?.abort(new RangePreempt('Foreground range split'));this.wakeProgress();return;
    }
  }
  /** Bounded scalars survive teardown in the host's durable recovery record. */
  get acquisitionState(){return {epoch:this.readEpoch.id,requests:this.metrics.requests,bytes:this.metrics.bytes,active:this.active,
    anchor:this.forwardSignal?this.forwardAnchor:null,demand:this.forwardDemand,ahead:this.ahead,cacheBytes:this.cachedBytes,cacheLimit:this.cacheLimit,
    runs:[...this.forwardRuns].map(run=>({next:run.next,end:run.end,demand:run.demand,pages:run.slots.size,request:!!run.request,
      paused:run.next>=run.demand+this.ahead})),demands:this.demands.map(value=>({...value}))};}
  private wakeProgress(){for(const wake of [...this.progressWaiters])wake();}
  private changed(signal:AbortSignal,waiters=this.progressWaiters){
    signal.throwIfAborted();return new Promise<void>((resolve,reject)=>{
      const clean=()=>{waiters.delete(wake);signal.removeEventListener('abort',abort);};
      const wake=()=>{clean();resolve();},abort=()=>{clean();reject(signal.reason);};
      waiters.add(wake);signal.addEventListener('abort',abort,{once:true});
    });
  }
  private trim(){while(this.cachedBytes>this.cacheLimit){const oldest=this.pages.keys().next().value!;this.cachedBytes-=this.pages.get(oldest)!.length;this.pages.delete(oldest);}}
  private store(index:number,bytes:Uint8Array){
    this.cachedBytes-=this.pages.get(index)?.length??0;this.pages.delete(index);this.pages.set(index,bytes);this.cachedBytes+=bytes.length;this.trim();
  }
  private notePage(scope:ReadEpoch,index:number,total:number){
    if(scope.seen===undefined){const length=Math.ceil(Math.ceil(total/PAGE)/8);scope.seen=length<=1024*1024?new Uint8Array(length):null;}
    if(scope.seen){const byte=index>>>3,bit=1<<(index&7);if(scope.seen[byte]&bit)scope.repeated++;else{scope.seen[byte]|=bit;scope.unique++;}}
    if(scope===this.readEpoch){this.metrics.uniquePageRequests=scope.seen?scope.unique:null;this.metrics.repeatedPageRequests=scope.seen?scope.repeated:null;}
  }
  /** Scalar metadata only, sampled by an explicit buffer-audit payload. */
  get bufferCache(){
    let end=this.forwardDemand,index=Math.floor(end/PAGE);
    if(this.forwardSignal)while(this.pages.has(index)){end=Math.max(end,index*PAGE+this.pages.get(index)!.length);index++;}
    return {ranges:[...this.pages].map(([index,bytes])=>({start:index*PAGE,end:index*PAGE+bytes.length})).sort((a,b)=>a.start-b.start),
      bytes:this.cachedBytes,limit:this.cacheLimit,readAhead:this.forwardSignal?Math.max(0,end-this.forwardDemand):0,offset:this.forwardDemand};
  }

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
    this.demands.push({offset,length});if(this.demands.length>12)this.demands.shift();
    this.maintainForward(offset,offset+length);
    const firstPage=Math.floor(offset/PAGE);
    if(length&&!this.pages.has(firstPage))this.prioritize(firstPage);
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
      this.store(index,bytes);
      return bytes;
    }).finally(() => {if(this.pending.get(index)===work)this.pending.delete(index);});
    this.pending.set(index,work); return work;
  }

  private async load(index: number,scope:ReadEpoch): Promise<Uint8Array> {
    const signal = this.lifetime.signal;
    // Random metadata outside every planned run must also get a network slot.
    if(this.active>=3){const background=[...this.forwardRuns].filter(run=>run.request)
      .sort((a,b)=>(b.next-b.demand)-(a.next-a.demand))[0];background?.request?.abort(new RangePreempt('Foreground metadata'));}
    while(this.active>=3)await this.changed(signal,this.slotWaiters);
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
    }finally{this.active--;for(const wake of [...this.slotWaiters])wake();}
  }

  private async loadForward(run:ForwardRun){
    let attempts=0;
    while(run.next<run.end){
      while(run.next>=run.demand+this.ahead)await this.changed(run.signal);
      while(this.active>=3)await this.changed(run.signal,this.slotWaiters);
      run.signal.throwIfAborted();this.active++;
      let failure:unknown;
      try{await this.streamForward(run);return;}catch(error){failure=error;}
      finally{this.active--;for(const wake of [...this.slotWaiters])wake();}
      run.signal.throwIfAborted();
      if(failure instanceof RangePreempt)continue;
      if(failure instanceof RangeFailure||attempts>=2)throw failure;
      await delay(200*2**attempts++,run.signal);
    }
  }

  private async streamForward(run:ForwardRun){
    const requestAbort=new AbortController(),signal=AbortSignal.any([run.signal,requestAbort.signal]);
    run.request=requestAbort;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const arm=()=>{timer=setTimeout(()=>requestAbort.abort(new TypeError('Original forward range stalled')),10000);};
    const disarm=()=>{if(timer)clearTimeout(timer);timer=undefined;};
    let body:ReadableStreamDefaultReader<Uint8Array>|undefined,complete=false;
    try{
      arm();const {response,at,firstByte,total}=await this.rangeResponse(run.next,run.end-1,signal);disarm();
      body=response.body?.getReader();if(!body)throw new RangeFailure('Original forward range has no body');
      let page=new Uint8Array(Math.min(PAGE,run.end-run.next)),filled=0,lastPublication=at;
      const cacheHit=Number(response.headers.get('Age')??0)>0||/hit/i.test(response.headers.get('X-Cache')??'');
      for(;;){
        signal.throwIfAborted();
        // Explicit backpressure: intentionally paused network reads have no
        // inactivity timer. A seek/epoch still cancels the fetch immediately.
        while(run.next<run.end&&run.next>=run.demand+this.ahead)await this.changed(signal);
        arm();let chunk:ReadableStreamReadResult<Uint8Array>;
        try{chunk=await body.read();}finally{disarm();}
        if(chunk.done){if(run.next!==run.end||filled)throw new TypeError('Original forward range was truncated');complete=true;break;}
        let cursor=0;
        while(cursor<chunk.value.length){
          signal.throwIfAborted();
          if(run.next>=run.end)throw new RangeFailure('Original forward body exceeds declared length');
          while(run.next>=run.demand+this.ahead)await this.changed(signal);
          const count=Math.min(page.length-filled,chunk.value.length-cursor);
          page.set(chunk.value.subarray(cursor,cursor+count),filled);cursor+=count;filled+=count;
          if(filled===page.length){
            const index=run.next/PAGE,slot=run.slots.get(index);
            if(!slot)throw new RangeFailure('Original forward page lost its owner');
            this.store(index,page);this.notePage(run.scope,index,total);
            const now=performance.now();this.metrics.bytes+=page.length;this.metrics.milliseconds+=now-lastPublication;
            this.bandwidth.sample(page.length,now-lastPublication,cacheHit);this.delivery.record(at,firstByte,page.length);lastPublication=now;
            if(this.pending.get(index)===slot.promise)this.pending.delete(index);run.slots.delete(index);slot.resolve(page);
            run.next+=page.length;filled=0;page=new Uint8Array(Math.min(PAGE,run.end-run.next));
          }
        }
      }
    }catch(error){if(requestAbort.signal.reason instanceof RangePreempt)throw requestAbort.signal.reason;throw error;}
    finally{
      if(run.request===requestAbort)run.request=undefined;
      disarm();if(body){if(!complete){requestAbort.abort();void body.cancel().catch(()=>{});}body.releaseLock();}
    }
  }

  private async rangeResponse(start:number,end:number,signal:AbortSignal){
    const headers=new Headers({Range:`bytes=${start}-${end}`});
    if(this.etag&&!this.etag.startsWith('W/'))headers.set('If-Range',this.etag);
    const at=performance.now();this.metrics.requests++;
    const response=await this.fetcher(this.url,{headers,signal,credentials:'same-origin',redirect:'error'}),firstByte=performance.now();
    try{
      if(response.status!==206){
        if(response.status===408||response.status===429||response.status>=500)throw new TypeError(`Original range HTTP ${response.status}`);
        throw new RangeFailure(`Original range requires206, received${response.status}`);
      }
      const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range')??'');
      const first=Number(range?.[1]),last=Number(range?.[2]),total=Number(range?.[3]);
      if(!range||![first,last,total].every(Number.isSafeInteger)||total<=0||first!==start||
        last!==Math.min(end,total-1)||last<first||total<=last||this.total!==null&&total!==this.total)
        throw new RangeFailure('Original range response changed or does not match request');
      const etag=response.headers.get('ETag'),modified=response.headers.get('Last-Modified');
      if(this.hasRevision&&(this.etag!==etag||this.modified!==modified))throw new RangeFailure('Original revision changed');
      this.total=total;this.etag=etag;this.modified=modified;this.hasRevision=true;
      return{response,at,firstByte,total,expected:last-first+1};
    }catch(error){await response.body?.cancel().catch(()=>{});if(error instanceof RangeFailure&&!signal.aborted)this.lifetime.abort(error);throw error;}
  }

  private async request(index: number, signal: AbortSignal,scope:ReadEpoch): Promise<Uint8Array> {
    const start = index * PAGE;
    const end = Math.min(start+PAGE-1,this.total === null ? Number.MAX_SAFE_INTEGER : this.total-1);
    if (end < start) throw new RangeFailure('Original page exceeds source length');
    const {response,at,firstByte,total,expected}=await this.rangeResponse(start,end,signal);
    try {
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
      this.notePage(scope,index,total);
      this.bandwidth.sample(written,performance.now()-at,Number(response.headers.get('Age')??0)>0||/hit/i.test(response.headers.get('X-Cache')??''));
      this.delivery.record(at,firstByte,written);
      this.metrics.bytes += written; this.metrics.milliseconds += performance.now()-at;
      return bytes;
    } catch (error) { if (!response.body?.locked) await response.body?.cancel().catch(() => {}); throw error; }
  }

  dispose(): void {
    this.lifetime.abort();for(const run of this.forwardRuns)this.cancelForward(run);this.wakeProgress();this.pages.clear();this.cachedBytes=0;
    for(const wake of [...this.slotWaiters])wake();
  }
}
