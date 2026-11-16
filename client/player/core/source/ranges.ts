import {DeliveryMeter,mediaCapWait} from './delivery';
import {BandwidthEstimator} from '../../abr';
import { abortable, delay } from '../async';
import type { ByteReader } from '../types';

const PAGE = 256 * 1024;
const MAX_READ = 16 * 1024 * 1024;
const CACHE = 72 * 1024 * 1024;
const MIB=1024*1024,WINDOW=64*MIB;
const METADATA=24*MIB;
class RangeFailure extends Error {}
class RangePreempt extends Error {}
interface ReadEpoch {id:number;seen:Uint8Array|null|undefined;unique:number;repeated:number}
interface PageSlot {promise:Promise<Uint8Array>;resolve(bytes:Uint8Array):void;reject(error:unknown):void}
interface ForwardRun {
  speculative?:boolean;
  metadata?:boolean;
  end:number;next:number;demand:number;scope:ReadEpoch;
  abort:AbortController;signal:AbortSignal;slots:Map<number,PageSlot>;
  request?:AbortController;
}

/** One pinned original, shared by AV and subtitles. Media runs use streamed
 * 64-MiB windows; metadata stays random-access. Five seconds of byte reserve
 * (8–64 MiB) starts at the media playhead. Protected front pages and a bounded
 * back-buffer share one cache; an LRU must never evict the decoder's future. */
export class RangeReader implements ByteReader {
  private readonly lifetime = new AbortController();
  private readonly pages = new Map<number, Uint8Array>();
  private readonly pending = new Map<number, Promise<Uint8Array>>();
  private readonly slotWaiters=new Set<()=>void>();
  private active = 0;
  private cachedBytes = 0;
  private cacheLimit=CACHE;
  private ahead=8*MIB;
  private mediaRate:number|null=null;
  private back=64*MIB;
  private playhead:number|null=null;
  private readonly metadata=new Set<number>();
  private metadataBytes=0;
  private readonly pageEpoch=new Map<number,number>();
  private readonly leases=new Map<number,number>();
  private readonly reads=new Set<{start:number;end:number;media:boolean}>();
  private readonly packets=new Map<string,{time:number;offset:number}[]>();
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
  readonly metrics = { requests: 0, bytes: 0, receivedBytes:0,cacheHits: 0, milliseconds: 0,
    sourceEpoch:0,uniquePageRequests:0 as number|null,repeatedPageRequests:0 as number|null };
  /** A bounded bitmap counts repeat physical acquisitions without retaining URLs
   * or a list of file offsets. Old pending reads retain their requesting epoch. */
  beginEpoch(id:number){
    for(const run of this.forwardRuns)this.cancelForward(run);
    this.forward=undefined;this.forwardSignal=undefined;this.forwardDemand=0;
    // Keep the retired cursor for cache reclamation during metadata admission.
    // The first media prefetch binds the new seek window. Clearing it here can
    // strand a new Cues page behind a full old cache before that bind happens.
    this.packets.clear();
    this.demands.length=0;
    this.readEpoch={id,seen:undefined,unique:0,repeated:0};
    this.metrics.sourceEpoch=id;this.metrics.uniquePageRequests=0;this.metrics.repeatedPageRequests=0;
  }
  configureBuffer(durationSeconds:number|null){
    const rate=this.total!==null&&durationSeconds!==null&&Number.isFinite(durationSeconds)&&durationSeconds>0?this.total/durationSeconds:null;
    this.mediaRate=rate===null?null:rate*8;
    this.ahead=Math.ceil(rate===null?8*MIB:Math.max(8*MIB,Math.min(64*MIB,rate*5)));
    // Reserve room for one 16-MiB speculative window, metadata and parser leases
    // without evicting the authoritative front window. Total remains <=128 MiB.
    this.back=64*MIB;
    this.cacheLimit=this.ahead+this.back;
    this.trim();this.wakeProgress();
  }
  prefetch(offset:number,signal:AbortSignal){
    signal.throwIfAborted();this.lifetime.signal.throwIfAborted();
    if(this.total===null||!Number.isSafeInteger(offset)||offset<0||offset>=this.total)return;
    if(!this.forwardSignal){this.forwardSignal=signal;this.forwardAnchor=offset;this.forwardDemand=offset;this.playhead=offset;this.trim();}
    this.forwardAnchor=Math.min(this.forwardAnchor,offset);
    this.maintainForward(offset,offset,true);
  }
  speculateMedia(offset:number,length:number,signal:AbortSignal,metadata=false){
    signal.throwIfAborted();
    if(this.total===null||!Number.isSafeInteger(offset)||offset<0||offset>=this.total||!Number.isSafeInteger(length)||length<=0||length>MAX_READ||length%PAGE!==0)
      throw new RangeFailure('Invalid speculative source window');
    this.cacheLimit=Math.max(this.cacheLimit,72*MIB);
    const start=Math.floor(offset/PAGE)*PAGE,end=Math.min(this.total,start+length),abort=new AbortController();
    const lifetime=AbortSignal.any([signal,abort.signal]),runs:ForwardRun[]=[];
    let index=start/PAGE;
    while(index*PAGE<end){
      if(this.pages.has(index)||this.pending.has(index)){index++;continue;}
      let limit=end;
      for(const at of [...this.pages.keys(),...this.pending.keys()])if(at>index&&at*PAGE<limit)limit=at*PAGE;
      runs.push(this.startForward(index*PAGE,limit,lifetime,true,metadata));index=Math.ceil(limit/PAGE);
    }
    const cancel=()=>{for(const run of runs)this.cancelForward(run);abort.abort();};
    const bytes=this.read(start,end-start,lifetime,true);void bytes.catch(()=>{});
    return{start,end,bytes,cancel,settle:(actualCluster:number)=>{
      if(actualCluster<start||actualCluster>=end)cancel();
      else for(const run of runs)run.speculative=false;
      this.prefetch(actualCluster,signal);
    }};
  }
  private maintainForward(offset:number,end:number,foreground=false){
    const signal=this.forwardSignal,previous=this.forward;
    if(!signal||signal.aborted||this.total===null||offset<this.forwardAnchor)return;
    // Random indexes do not retarget the established media run.
    if(!foreground&&previous&&offset>previous.end+MAX_READ)return;
    this.forwardDemand=Math.max(this.forwardDemand,end);
    for(const run of this.forwardRuns)run.demand=this.playhead??offset;
    this.wakeProgress();
    const wanted=Math.min(this.total,this.edge());
    let index=Math.floor(Math.max(offset,this.playhead??offset)/PAGE);
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
  private startForward(start:number,limit:number,signal:AbortSignal,speculative=false,metadata=false){
    const abort=new AbortController();
    const run:ForwardRun={speculative,metadata,end:limit,next:start,demand:this.playhead??start,scope:this.readEpoch,
      abort,signal:AbortSignal.any([signal,this.lifetime.signal,abort.signal]),slots:new Map()};
    for(let at=start;at<limit;at+=PAGE){
      let resolve!:(bytes:Uint8Array)=>void,reject!:(error:unknown)=>void;
      const promise=new Promise<Uint8Array>((yes,no)=>{resolve=yes;reject=no;});
      void promise.catch(()=>{});const slot={promise,resolve,reject};run.slots.set(at/PAGE,slot);this.pending.set(at/PAGE,promise);
    }
    if(!speculative)this.forward=run;this.forwardRuns.add(run);
    void this.loadForward(run).catch(error=>{this.rejectForward(run,error);if(error instanceof RangeFailure&&!run.signal.aborted)this.lifetime.abort(error);}).finally(()=>{
      this.forwardRuns.delete(run);this.wakeProgress();
    });
    return run;
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
      const abort=new AbortController(),tail:ForwardRun={speculative:run.speculative,metadata:run.metadata,end:run.end,next:cut,demand:this.playhead??cut,scope:run.scope,
        abort,signal:AbortSignal.any([run.signal,abort.signal]),slots:new Map()};
      for(const [at,slot]of run.slots)if(at>=index){tail.slots.set(at,slot);run.slots.delete(at);}
      run.end=cut;if(!tail.speculative)this.forward=tail;this.forwardRuns.add(tail);
      void this.loadForward(tail).catch(error=>{this.rejectForward(tail,error);if(error instanceof RangeFailure&&!tail.signal.aborted)this.lifetime.abort(error);})
        .finally(()=>{this.forwardRuns.delete(tail);this.wakeProgress();});
      run.request?.abort(new RangePreempt('Foreground range split'));this.wakeProgress();return;
    }
  }
  /** Bounded scalars survive teardown in the host's durable recovery record. */
  get acquisitionState(){return {epoch:this.readEpoch.id,requests:this.metrics.requests,bytes:this.metrics.bytes,active:this.active,
    anchor:this.forwardSignal?this.forwardAnchor:null,playhead:this.playhead,demand:this.forwardDemand,ahead:this.ahead,back:this.back,cacheBytes:this.cachedBytes,cacheLimit:this.cacheLimit,
    runs:[...this.forwardRuns].map(run=>({next:run.next,end:run.end,demand:run.demand,pages:run.slots.size,request:!!run.request,
      paused:run.next>=this.edge(run)})),demands:this.demands.map(value=>({...value}))};}
  get mediaBitrateBps(){return this.mediaRate;}
  get forwardReserveBytes(){
    if(this.playhead===null||!this.forwardSignal)return 0;
    let end=this.playhead,index=Math.floor(end/PAGE);
    while(this.pages.has(index)){end=Math.max(end,index*PAGE+this.pages.get(index)!.length);index++;}
    return Math.max(0,end-this.playhead);
  }
  private wakeProgress(){for(const wake of [...this.progressWaiters])wake();}
  private changed(signal:AbortSignal,waiters=this.progressWaiters){
    signal.throwIfAborted();return new Promise<void>((resolve,reject)=>{
      const clean=()=>{waiters.delete(wake);signal.removeEventListener('abort',abort);};
      const wake=()=>{clean();resolve();},abort=()=>{clean();reject(signal.reason);};
      waiters.add(wake);signal.addEventListener('abort',abort,{once:true});
    });
  }
  retain(offset:number,length:number){
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<0||length>MAX_READ+PAGE)throw new RangeFailure('Invalid retained source span');
    const indexes:number[]=[];for(let at=Math.floor(offset/PAGE);at*PAGE<offset+length;at++){indexes.push(at);this.leases.set(at,(this.leases.get(at)??0)+1);}
    let held=true;return()=>{if(!held)return;held=false;for(const at of indexes){const count=this.leases.get(at)??0;if(count<=1)this.leases.delete(at);else this.leases.set(at,count-1);}this.trim();this.wakeProgress();};
  }
  notePacket(kind:string,time:number,offset:number){
    if(!Number.isFinite(time)||!Number.isSafeInteger(offset)||offset<0||this.total!==null&&offset>=this.total)return;
    const rows=this.packets.get(kind)??[];rows.push({time,offset});if(rows.length>2048)rows.shift();this.packets.set(kind,rows);
  }
  /** File offsets are supplied by demuxed packets, not an average byte estimate.
   * B-frame presentation reordering cannot move a source window backwards. */
  advance(time:number){
    if(this.playhead===null)return;
    const head=(kind:string)=>{let at:number|null=null;for(const row of this.packets.get(kind)??[])if(row.time<=time)at=Math.max(at??0,row.offset);return at;};
    const video=head('video'),audio=head('audio');if(video===null)return;
    this.playhead=Math.max(this.playhead,audio===null?video:Math.min(video,audio));
    for(const [kind,rows]of this.packets){const kept=rows.filter(row=>row.time>=time-1000000);const earlier=rows.filter(row=>row.time<time-1000000).sort((a,b)=>b.time-a.time)[0];if(earlier)kept.unshift(earlier);this.packets.set(kind,kept);}
    for(const run of this.forwardRuns)run.demand=this.playhead;
    this.trim();this.wakeProgress();
  }
  private edge(run?:ForwardRun){
    if(run?.speculative)return run.end;
    let edge=(this.playhead??this.forwardAnchor)+this.ahead;
    for(const read of this.reads)if(read.media&&(!run||read.start<run.end&&read.end>run.next))edge=Math.max(edge,read.end);
    return Math.min(this.total??Number.MAX_SAFE_INTEGER,Math.ceil(edge/PAGE)*PAGE);
  }
  private isMedia(offset:number){return this.playhead!==null&&(offset>=this.playhead-this.back&&offset<this.playhead+this.ahead+MAX_READ||
    [...this.forwardRuns].some(run=>!run.signal.aborted&&offset>=run.next&&offset<run.end));}
  private drop(index:number){const bytes=this.pages.get(index);if(!bytes)return;this.cachedBytes-=bytes.length;if(this.metadata.delete(index))this.metadataBytes-=bytes.length;this.pages.delete(index);this.pageEpoch.delete(index);}
  private trim(needed=0){
    if(this.playhead===null)return;
    const indexes=[...this.pages.keys()].sort((a,b)=>a-b);
    for(const at of indexes){
      if(this.metadata.has(at)||this.leases.has(at))continue;
      const end=at*PAGE+this.pages.get(at)!.length;
      // Completed old-epoch bytes outside the new seek window are retired;
      // current-epoch future pages are never an eviction candidate.
      const retired=this.pageEpoch.get(at)!==this.readEpoch.id&&(end<=this.playhead-this.back||at*PAGE>=this.edge());
      if(retired||end<=this.playhead&&(end<=this.playhead-this.back||this.cachedBytes+needed>this.cacheLimit))this.drop(at);
    }
  }
  private async store(index:number,bytes:Uint8Array,scope:ReadEpoch,signal:AbortSignal,media:boolean){
    const extra=bytes.length-(this.pages.get(index)?.length??0);
    if(!media&&!this.metadata.has(index)&&this.metadataBytes+bytes.length>METADATA)throw new RangeFailure('Original metadata cache exceeds its bounded reserve');
    for(;;){signal.throwIfAborted();this.trim(extra);if(this.cachedBytes+extra<=this.cacheLimit)break;await this.changed(signal);}
    this.drop(index);this.pages.set(index,bytes);this.pageEpoch.set(index,scope.id);this.cachedBytes+=bytes.length;
    if(!media){this.metadata.add(index);this.metadataBytes+=bytes.length;}
  }
  private notePage(scope:ReadEpoch,index:number,total:number){
    if(scope.seen===undefined){const length=Math.ceil(Math.ceil(total/PAGE)/8);scope.seen=length<=1024*1024?new Uint8Array(length):null;}
    if(scope.seen){const byte=index>>>3,bit=1<<(index&7);if(scope.seen[byte]&bit)scope.repeated++;else{scope.seen[byte]|=bit;scope.unique++;}}
    if(scope===this.readEpoch){this.metrics.uniquePageRequests=scope.seen?scope.unique:null;this.metrics.repeatedPageRequests=scope.seen?scope.repeated:null;}
  }
  /** Scalar metadata only, sampled by an explicit buffer-audit payload. */
  get bufferCache(){
    let end=this.playhead??this.forwardDemand,index=Math.floor(end/PAGE);
    if(this.forwardSignal)while(this.pages.has(index)){end=Math.max(end,index*PAGE+this.pages.get(index)!.length);index++;}
    return {ranges:[...this.pages].map(([index,bytes])=>({start:index*PAGE,end:index*PAGE+bytes.length})).sort((a,b)=>a.start-b.start),
      bytes:this.cachedBytes,limit:this.cacheLimit,readAhead:this.forwardSignal?Math.max(0,end-(this.playhead??end)):0,offset:this.playhead??this.forwardDemand};
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

  async read(offset: number, length: number, signal: AbortSignal,speculativeRead=false): Promise<Uint8Array> {
    signal.throwIfAborted(); this.lifetime.signal.throwIfAborted();
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 ||
        length > MAX_READ || !Number.isSafeInteger(offset + length)) throw new RangeFailure('Invalid or oversized original read');
    const total = await this.size(signal);
    if (offset + length > total) throw new RangeFailure('Original read exceeds pinned source length');
    const release=this.retain(offset,length),read={start:offset,end:offset+length,media:this.isMedia(offset)};this.reads.add(read);
    try{
    this.demands.push({offset,length});if(this.demands.length>12)this.demands.shift();
    this.maintainForward(offset,offset+length);
    const firstPage=Math.floor(offset/PAGE);
    // Warming must not preempt itself; every real parser demand still can.
    if(length&&!speculativeRead&&!this.pages.has(firstPage))this.prioritize(firstPage);
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
    }finally{this.reads.delete(read);release();}
  }

  private page(index: number): Promise<Uint8Array> {
    this.lifetime.signal.throwIfAborted();
    const cached = this.pages.get(index);
    if (cached) { this.pages.delete(index); this.pages.set(index,cached); this.metrics.cacheHits++; return Promise.resolve(cached); }
    const pending = this.pending.get(index); if (pending) return pending;
    const scope=this.readEpoch,media=this.isMedia(index*PAGE);
    const work = this.load(index,scope,media).then(async bytes => {
      this.lifetime.signal.throwIfAborted();
      await this.store(index,bytes,scope,this.lifetime.signal,media);
      return bytes;
    }).finally(() => {if(this.pending.get(index)===work)this.pending.delete(index);});
    this.pending.set(index,work); return work;
  }

  private async load(index: number,scope:ReadEpoch,media:boolean): Promise<Uint8Array> {
    const signal = this.lifetime.signal;
    // Random metadata outside every planned run must also get a network slot.
    if(this.active>=3){const background=[...this.forwardRuns].filter(run=>run.request)
      .sort((a,b)=>(b.next-b.demand)-(a.next-a.demand))[0];background?.request?.abort(new RangePreempt('Foreground metadata'));}
    while(this.active>=3)await this.changed(signal,this.slotWaiters);
    signal.throwIfAborted(); this.active++;
    try {
      for (let attempt = 0;; attempt++) {
        signal.throwIfAborted();
        try { return await this.request(index,AbortSignal.any([signal,AbortSignal.timeout(10000)]),scope,media); }
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
      while(run.next>=this.edge(run))await this.changed(run.signal);
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
        while(run.next<run.end&&run.next>=this.edge(run))await this.changed(signal);
        arm();let chunk:ReadableStreamReadResult<Uint8Array>;
        try{chunk=await body.read();}finally{disarm();}
        if(chunk.done){if(run.next!==run.end||filled)throw new TypeError('Original forward range was truncated');complete=true;break;}
        this.metrics.receivedBytes+=chunk.value.length;
        let cursor=0;
        while(cursor<chunk.value.length){
          signal.throwIfAborted();
          if(run.next>=run.end)throw new RangeFailure('Original forward body exceeds declared length');
          while(run.next>=this.edge(run))await this.changed(signal);
          const count=Math.min(page.length-filled,chunk.value.length-cursor);
          page.set(chunk.value.subarray(cursor,cursor+count),filled);cursor+=count;filled+=count;
          if(filled===page.length){
            const index=run.next/PAGE,slot=run.slots.get(index);
            if(!slot)throw new RangeFailure('Original forward page lost its owner');
            await this.store(index,page,run.scope,signal,!run.metadata);this.notePage(run.scope,index,total);
            const now=performance.now();this.metrics.bytes+=page.length;this.metrics.milliseconds+=now-lastPublication;
            this.bandwidth.sample(page.length,now-lastPublication,cacheHit);
            this.delivery.record(at,firstByte,page.length,{intervalStart:lastPublication,kind:run.metadata?'metadata':run.speculative?'speculative':'media',capWaitMs:mediaCapWait(response)});lastPublication=now;
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

  private async request(index: number, signal: AbortSignal,scope:ReadEpoch,media:boolean): Promise<Uint8Array> {
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
          this.metrics.receivedBytes+=value.length;
          if (written+value.length > expected) throw new RangeFailure('Original range body exceeds declared length');
          bytes.set(value,written); written += value.length;
        }
      } finally { if (written !== expected) await body.cancel().catch(() => {}); body.releaseLock(); }
      if (written !== expected) throw new TypeError('Original range body was truncated');
      this.notePage(scope,index,total);
      this.bandwidth.sample(written,performance.now()-at,Number(response.headers.get('Age')??0)>0||/hit/i.test(response.headers.get('X-Cache')??''));
      this.delivery.record(at,firstByte,written,{kind:media?'media':'metadata',capWaitMs:mediaCapWait(response)});
      this.metrics.bytes += written; this.metrics.milliseconds += performance.now()-at;
      return bytes;
    } catch (error) { if (!response.body?.locked) await response.body?.cancel().catch(() => {}); throw error; }
  }

  dispose(): void {
    this.lifetime.abort();for(const run of this.forwardRuns)this.cancelForward(run);this.wakeProgress();this.pages.clear();this.cachedBytes=0;
    this.metadata.clear();this.metadataBytes=0;this.pageEpoch.clear();this.packets.clear();
    for(const wake of [...this.slotWaiters])wake();
  }
}
