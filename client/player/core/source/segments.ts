import {DeliveryMeter} from './delivery';
import {LiveWindow} from './live-window';
import {BandwidthEstimator} from '../../abr';
import { CustomPathedSource, CustomSource } from 'mediabunny';
import { abortable, delay } from '../async';

const MAX_OBJECT=16*1024*1024,MAX_PLAYLIST=1024*1024,CACHE_BYTES=32*1024*1024;
class SegmentFailure extends Error {}
interface ObjectBytes {bytes:Uint8Array;playlist:boolean;at:number}

/** Vela owns acquisition, URL policy, retries and caching; HLS parsing is a library. */
export class SegmentReader {
  private readonly lifetime=new AbortController();
  private readonly cache=new Map<string,ObjectBytes>();
  private readonly pending=new Map<string,{signal:AbortSignal;promise:Promise<ObjectBytes>}>();
  private readonly waiters=new Set<()=>void>();
  private active=0;
  private cached=0;
  private root:string;
  readonly liveWindow?:LiveWindow;
  networkRetries=0;retrying=false;
  private polling?:ReturnType<typeof setInterval>;
  readonly bandwidth=new BandwidthEstimator();
  readonly delivery=new DeliveryMeter();
  readonly metrics={requests:0,bytes:0,cacheHits:0,milliseconds:0};
  readonly diagnostics:string[]=[];
  constructor(url:string,private readonly fetcher:typeof fetch=(...args)=>fetch(...args),private readonly allowed?:(url:URL)=>boolean,private readonly cacheIdentity='local',live=false){
    this.root=this.scoped(url);
    if(live)this.liveWindow=new LiveWindow();
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
      if(!this.liveWindow&&!lines.includes('#EXT-X-ENDLIST'))throw new SegmentFailure('Moving HLS requires the live-window adapter');
      if(lines.some(line=>line.startsWith('#EXT-X-KEY:')&&!/METHOD=NONE(?:,|$)/.test(line)))
        throw new SegmentFailure('Encrypted HLS requires an authorized decryption route');
      if(this.liveWindow&&this.liveWindow.edge<=this.liveWindow.start){
        if(lines.includes('#EXT-X-ENDLIST'))throw new SegmentFailure('Live stream ended before publishing media');
        await delay(100,signal);depth--;continue;
      }
      if(this.liveWindow&&!this.polling)this.polling=setInterval(()=>{void this.object(this.root,this.lifetime.signal,true).catch(()=>{});},1000);
      return;
    }
    throw new SegmentFailure('HLS variant nesting exceeded its bound');
  }
  createSource(signal:()=>AbortSignal,count:(bytes:number)=>void):CustomPathedSource{
    return new CustomPathedSource(this.root,request=>{
      const path=this.scoped(String(request.path));
      let expectedLength:number|undefined;
      // One CustomSource owns one playlist version even if the next reload
      // publishes while its size/header/body are being read.
      let snapshot:Promise<ObjectBytes>|undefined;
      const object=()=>snapshot??=this.object(path,signal());
      return new CustomSource({maxCacheSize:0,prefetchProfile:'none',
        getSize:async()=>{const value=await object();expectedLength=value.bytes.length;return expectedLength;},
        read:async(start,end)=>{count(end-start);const value=await object();
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>value.bytes.length)
            throw new SegmentFailure(`Invalid segment byte request (${start}:${end}, size ${value.bytes.length}, indexed ${expectedLength??-1})`);
          if(expectedLength!==undefined&&expectedLength!==value.bytes.length)throw new SegmentFailure(`Segment changed within its generation (size ${value.bytes.length}, indexed ${expectedLength})`);
          return value.bytes.subarray(start,end);
        },
      });
    });
  }
  private async object(path:string,signal:AbortSignal,playlist=false):Promise<ObjectBytes>{
    signal.throwIfAborted();this.lifetime.signal.throwIfAborted();
    const key=`${this.cacheIdentity}:${path}`;
    const existing=this.cache.get(key);
    if(existing&&!(this.liveWindow&&existing.playlist&&performance.now()-existing.at>=250)){this.cache.delete(key);this.cache.set(key,existing);this.metrics.cacheHits++;return existing;}
    if(existing){this.cache.delete(key);this.cached-=existing.bytes.length;}
    const current=this.pending.get(key);
    if(current&&!current.signal.aborted)return abortable(current.promise,signal);
    const operation=AbortSignal.any([signal,this.lifetime.signal]);
    const entry={signal:operation,promise:Promise.resolve(null as unknown as ObjectBytes)};
    entry.promise=this.load(path,operation,playlist).then(value=>{
      operation.throwIfAborted();this.cache.set(key,value);this.cached+=value.bytes.length;
      while(this.cached>CACHE_BYTES){const key=this.cache.keys().next().value!;this.cached-=this.cache.get(key)!.bytes.length;this.cache.delete(key);}
      return value;
    }).finally(()=>{if(this.pending.get(key)===entry)this.pending.delete(key);});
    this.pending.set(key,entry);return abortable(entry.promise,operation);
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
        try{const value=await this.request(path,AbortSignal.any([signal,AbortSignal.timeout(10000)]),playlist);this.retrying=false;return value;}
        catch(error){signal.throwIfAborted();if(error instanceof SegmentFailure||attempt>=2)throw error;this.networkRetries++;this.retrying=true;await delay(200*2**attempt,signal);}
      }
    }finally{this.active--;this.waiters.values().next().value?.();}
  }
  private async request(path:string,signal:AbortSignal,playlist:boolean):Promise<ObjectBytes>{
    const at=performance.now(),request=++this.metrics.requests;
    const response=await this.fetcher(path,{signal,credentials:'same-origin',redirect:'error',cache:'no-store'});
    const firstByte=performance.now();
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
      let bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      if(!playlist){
        // Fixed vocabulary only: never expose a URL, response text, media bytes
        // or arbitrary fourcc. Retain just the last eight bounded object facts.
        this.diagnostics.push(`hls-object:${request}:bytes=${size}:${objectShape(bytes)}`);
        if(this.diagnostics.length>8)this.diagnostics.shift();
      }
      if(!playlist)this.delivery.record(at,firstByte,size);
      if(!playlist)this.bandwidth.sample(size,performance.now()-at,Number(response.headers.get('Age')??0)>0||/hit/i.test(response.headers.get('X-Cache')??''));
      this.metrics.bytes+=size;this.metrics.milliseconds+=performance.now()-at;
      if(playlist&&this.liveWindow&&path===this.root){
        const text=new TextDecoder().decode(bytes);
        if(!text.includes('#EXT-X-STREAM-INF:'))try{
          const sequence=response.headers.get('X-Ether-Live-Media-Sequence'),start=response.headers.get('X-Ether-Live-Window-Start');
          if(sequence!==null&&sequence.trim()===''||start!==null&&start.trim()==='')throw new Error('Invalid live anchor header');
          const anchor=sequence!==null&&start!==null?{mediaSequence:Number(sequence),windowStartSeconds:Number(start)}:undefined;
          bytes=new TextEncoder().encode(this.liveWindow.update(text,anchor));
        }catch(error){throw new SegmentFailure(error instanceof Error?error.message:'Invalid live timeline');}
      }
      return{bytes,playlist,at:performance.now()};
    }catch(error){if(!response.body?.locked)await response.body?.cancel().catch(()=>{});throw error;}
  }
  dispose(){if(this.polling)clearInterval(this.polling);this.polling=undefined;this.lifetime.abort();this.cache.clear();this.pending.clear();this.cached=0;for(const wake of [...this.waiters])wake();}
}

function objectShape(bytes:Uint8Array):string{
  if(bytes[0]===0x47&&(bytes.length<189||bytes[188]===0x47))return 'mpegts';
  const known=new Set(['ftyp','styp','moov','moof','mdat','sidx','emsg','prft','free','skip','wide','mfra','mfro']);
  const boxes:string[]=[],view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let at=0;at<bytes.length&&boxes.length<32;){
    if(at+8>bytes.length)return boxes.join(',')+':truncated-header';
    let size=view.getUint32(at);const type=String.fromCharCode(...bytes.subarray(at+4,at+8));
    if(!known.has(type))return boxes.join(',')+':other';
    let header=8;
    if(size===1){if(at+16>bytes.length)return boxes.join(',')+':truncated-header';size=Number(view.getBigUint64(at+8));header=16;}
    else if(size===0)size=bytes.length-at;
    if(!Number.isSafeInteger(size)||size<header||size>bytes.length-at)return boxes.join(',')+':invalid-size';
    boxes.push(type);at+=size;
  }
  return boxes.length?boxes.join(','):'empty';
}
