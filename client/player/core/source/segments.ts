import {BandwidthEstimator} from '../../abr';
import { CustomPathedSource, CustomSource } from 'mediabunny';
import { abortable, delay } from '../async';

const MAX_OBJECT=16*1024*1024,MAX_PLAYLIST=1024*1024,CACHE_BYTES=32*1024*1024;
class SegmentFailure extends Error {}
interface ObjectBytes {bytes:Uint8Array;playlist:boolean}

/** Vela owns acquisition, URL policy, retries and caching; HLS parsing is a library. */
export class SegmentReader {
  private readonly lifetime=new AbortController();
  private readonly cache=new Map<string,ObjectBytes>();
  private readonly pending=new Map<string,{signal:AbortSignal;promise:Promise<ObjectBytes>}>();
  private readonly waiters=new Set<()=>void>();
  private active=0;
  private cached=0;
  private root:string;
  readonly bandwidth=new BandwidthEstimator();
  readonly metrics={requests:0,bytes:0,cacheHits:0,milliseconds:0};
  constructor(url:string,private readonly fetcher:typeof fetch=(...args)=>fetch(...args),private readonly allowed?:(url:URL)=>boolean){
    this.root=this.scoped(url);
  }
  private scoped(path:string):string{
    const url=new URL(path,location.href);
    if(!['http:','https:'].includes(url.protocol)||(this.allowed?!this.allowed(url):url.origin!==location.origin)||url.username||url.password||url.hash)
      throw new SegmentFailure('Segment input must use same-origin scoped HTTP URLs');
    return url.href;
  }
  /** Pin the first advertised variant. Looking at metadata must not start other encoders. */
  async prepare(signal:AbortSignal):Promise<void>{
    for(let depth=0;depth<3;depth++){
      const object=await this.object(this.root,signal,true);
      const text=new TextDecoder().decode(object.bytes);
      if(!text.trimStart().startsWith('#EXTM3U'))throw new SegmentFailure('Invalid HLS playlist');
      const lines=text.split(/\r?\n/).map(line=>line.trim());
      const first=lines.findIndex(line=>line.startsWith('#EXT-X-STREAM-INF:'));
      if(first>=0){
        const target=lines[first+1];
        if(!target||target.startsWith('#'))throw new SegmentFailure('Missing HLS variant URL');
        // Alternate groups need an explicit coordinated stream selection. They
        // are not silently treated as muxed audio by this initial VOD adapter.
        if(lines.some(line=>line.startsWith('#EXT-X-MEDIA:')&&/TYPE=AUDIO(?:,|$)/.test(line)&&/URI=/.test(line)))
          throw new SegmentFailure('Separate HLS audio requires coordinated rendition selection');
        this.root=this.scoped(new URL(target,this.root).href);continue;
      }
      if(!lines.includes('#EXT-X-ENDLIST'))throw new SegmentFailure('Moving HLS requires the live-window adapter');
      if(lines.some(line=>line.startsWith('#EXT-X-KEY:')&&!/METHOD=NONE(?:,|$)/.test(line)))
        throw new SegmentFailure('Encrypted HLS requires an authorized decryption route');
      return;
    }
    throw new SegmentFailure('HLS variant nesting exceeded its bound');
  }
  createSource(signal:()=>AbortSignal,count:(bytes:number)=>void):CustomPathedSource{
    return new CustomPathedSource(this.root,request=>{
      const path=this.scoped(String(request.path));
      return new CustomSource({maxCacheSize:0,prefetchProfile:'none',
        getSize:async()=>{const value=await this.object(path,signal());return value.bytes.length;},
        read:async(start,end)=>{count(end-start);const value=await this.object(path,signal());
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>value.bytes.length)
            throw new SegmentFailure('Invalid segment byte request');
          return value.bytes.subarray(start,end);
        },
      });
    });
  }
  private async object(path:string,signal:AbortSignal,playlist=false):Promise<ObjectBytes>{
    signal.throwIfAborted();this.lifetime.signal.throwIfAborted();
    const existing=this.cache.get(path);
    if(existing){this.cache.delete(path);this.cache.set(path,existing);this.metrics.cacheHits++;return existing;}
    const current=this.pending.get(path);
    if(current&&!current.signal.aborted)return abortable(current.promise,signal);
    const operation=AbortSignal.any([signal,this.lifetime.signal]);
    const entry={signal:operation,promise:Promise.resolve(null as unknown as ObjectBytes)};
    entry.promise=this.load(path,operation,playlist).then(value=>{
      operation.throwIfAborted();this.cache.set(path,value);this.cached+=value.bytes.length;
      while(this.cached>CACHE_BYTES){const key=this.cache.keys().next().value!;this.cached-=this.cache.get(key)!.bytes.length;this.cache.delete(key);}
      return value;
    }).finally(()=>{if(this.pending.get(path)===entry)this.pending.delete(path);});
    this.pending.set(path,entry);return abortable(entry.promise,operation);
  }
  private async slot(signal:AbortSignal){
    while(this.active>=2)await abortable(new Promise<void>(resolve=>{
      const wake=()=>{this.waiters.delete(wake);signal.removeEventListener('abort',wake);resolve();};
      this.waiters.add(wake);signal.addEventListener('abort',wake,{once:true});
    }),signal);
    signal.throwIfAborted();this.active++;
  }
  private async load(path:string,signal:AbortSignal,playlist:boolean):Promise<ObjectBytes>{
    await this.slot(signal);
    try{
      for(let attempt=0;;attempt++){
        signal.throwIfAborted();
        try{return await this.request(path,AbortSignal.any([signal,AbortSignal.timeout(10000)]),playlist);}
        catch(error){signal.throwIfAborted();if(error instanceof SegmentFailure||attempt>=2)throw error;await delay(200*2**attempt,signal);}
      }
    }finally{this.active--;this.waiters.values().next().value?.();}
  }
  private async request(path:string,signal:AbortSignal,playlist:boolean):Promise<ObjectBytes>{
    const at=performance.now();this.metrics.requests++;
    const response=await this.fetcher(path,{signal,credentials:'same-origin',redirect:'error'});
    try{
      if(response.status!==200){
        if(response.status===408||response.status===429||response.status>=500)throw new TypeError(`Segment HTTP ${response.status}`);
        throw new SegmentFailure(`Segment HTTP ${response.status}`);
      }
      const type=response.headers.get('Content-Type')??'';
      if(/text\/html|application\/json/i.test(type))throw new SegmentFailure('Media endpoint returned a document instead of media');
      playlist||=/mpegurl/i.test(type)||new URL(path).pathname.endsWith('.m3u8');
      const limit=playlist?MAX_PLAYLIST:MAX_OBJECT;
      const declared=response.headers.get('Content-Length');
      const length=declared===null?null:Number(declared);
      if(length!==null&&(!Number.isSafeInteger(length)||length<0||length>limit))throw new SegmentFailure('Segment object exceeds its byte bound');
      const reader=response.body?.getReader();if(!reader)throw new TypeError('Segment response has no body');
      const chunks:Uint8Array[]=[];let size=0,complete=false;
      try{
        for(;;){const result=await reader.read();if(result.done){complete=true;break;}
          size+=result.value.length;if(size>limit)throw new SegmentFailure('Segment object exceeds its byte bound');chunks.push(result.value);
        }
      }finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
      if(length!==null&&size!==length)throw new TypeError('Segment response was truncated');
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      if(!playlist)this.bandwidth.sample(size,performance.now()-at,Number(response.headers.get('Age')??0)>0||/hit/i.test(response.headers.get('X-Cache')??''));
      this.metrics.bytes+=size;this.metrics.milliseconds+=performance.now()-at;
      return{bytes,playlist};
    }catch(error){if(!response.body?.locked)await response.body?.cancel().catch(()=>{});throw error;}
  }
  dispose(){this.lifetime.abort();this.cache.clear();this.cached=0;for(const wake of [...this.waiters])wake();}
}
