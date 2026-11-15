/** Scalar-only, optional measurement hooks. No source URLs or media bytes. */
export interface SourceBufferAudit {
  /** Total retained bytes includes pinned header/index entries; limit is evictable cache. */
  cacheBytes:number;cacheLimitBytes:number;readAheadLimitBytes:number;
  /** Raw contiguous bytes beyond the last demuxed AV cluster; may include metadata. */
  forwardBytes:number|null;
  /** Indexed complete-cluster bounds; null until an already-loaded index proves them. */
  cachedStartSeconds:number|null;cachedEndSeconds:number|null;
  videoReadEndSeconds:number|null;audioReadEndSeconds:number|null;
}
interface Cue {time:number;clusterPosition:number}
interface Cursor {start:number;end:number;time:number}
interface State {video?:Cursor;audio?:Cursor;cues?:readonly Cue[];factor:number;ordered:boolean}
interface CacheRange {start:number;end:number}
export interface BufferCacheState {ranges:readonly CacheRange[];bytes:number;limit:number;readAhead:number;offset:number}
const states=new WeakMap<object,State>();

/** References the demuxer's existing AV index; does not load or copy a new one.
 * Validate ordering once when its immutable per-track cue array is replaced. */
export function observeBufferPacket(source:object,kind:'video'|'audio',start:number,end:number,time:number,
  cues:readonly Cue[],factor:number):void {
  let state=states.get(source);if(!state){state={factor,ordered:false};states.set(source,state);}
  state[kind]={start,end,time};
  if(kind==='video'&&state.cues!==cues){
    state.cues=cues;state.factor=factor;state.ordered=cues.length>0&&Number.isFinite(factor)&&factor>0;
    for(let i=0;state.ordered&&i<cues.length;i++){
      const cue=cues[i];
      if(!Number.isFinite(cue.time)||!Number.isSafeInteger(cue.clusterPosition)||cue.clusterPosition<0||
        i>0&&(cue.clusterPosition<cues[i-1].clusterPosition||cue.time<cues[i-1].time))state.ordered=false;
    }
  }
}
export function resetBufferAudit(source:object):void{states.delete(source);}
export function hasBufferAudit(source:object):boolean{return states.has(source);}

/** Core supplies its own cache's scalar intervals; wrapper reads the library's
 * existing cache metadata. Neither route changes cache policy or reads media. */
export function sourceBufferAudit(source:object,cache?:BufferCacheState):SourceBufferAudit|null {
  if(!cache){
    const value=source as {_offset?:number;_readAhead?:number;_orchestrator?:{
      cache:CacheRange[];currentCacheSize:number;options:{maxCacheSize:number}}};
    const orchestrator=value._orchestrator;if(!orchestrator||!Array.isArray(orchestrator.cache))return null;
    cache={ranges:orchestrator.cache,bytes:orchestrator.cache.reduce((bytes,range)=>bytes+range.end-range.start,0),limit:orchestrator.options.maxCacheSize,
      readAhead:value._readAhead??0,offset:value._offset??0};
  }
  const state=states.get(source),cursors=[state?.video,state?.audio].filter((cursor):cursor is Cursor=>!!cursor);
  let start:number|null=null,end:number|null=null,frontier:number|null=null;
  if(cursors.length){
    const first=Math.min(...cursors.map(cursor=>cursor.start))+cache.offset;
    frontier=Math.max(...cursors.map(cursor=>cursor.end))+cache.offset;
    // Both implementations supply sorted, nonoverlapping cache intervals.
    let componentStart=0,componentEnd=-1;
    for(const range of cache.ranges){
      if(start===null){
        if(range.start>componentEnd){componentStart=range.start;componentEnd=range.end;}
        else componentEnd=Math.max(componentEnd,range.end);
        if(componentStart<=first&&componentEnd>first){start=componentStart;end=componentEnd;}
      }
      else if(range.start<=end!)end=Math.max(end!,range.end);else break;
    }
  }
  let cachedStartSeconds:number|null=null,cachedEndSeconds:number|null=null;
  if(state?.ordered&&state.cues&&start!==null&&end!==null){
    const cues=state.cues;
    const lower=(position:number)=>{let lo=0,hi=cues.length;while(lo<hi){const mid=(lo+hi)>>>1;
      if(cues[mid].clusterPosition+cache.offset<position)lo=mid+1;else hi=mid;}return lo;};
    const first=lower(start),after=lower(end);
    if(first<cues.length&&after>first){
      cachedStartSeconds=cues[first].time/state.factor;
      // A cue at the next cluster's start proves all bytes preceding it are cached.
      cachedEndSeconds=cues[after-1].time/state.factor;
    }
  }
  return {cacheBytes:cache.bytes,cacheLimitBytes:cache.limit,readAheadLimitBytes:cache.readAhead,
    forwardBytes:end!==null&&frontier!==null?Math.max(0,end-frontier):null,cachedStartSeconds,cachedEndSeconds,
    videoReadEndSeconds:state?.video?.time??null,audioReadEndSeconds:state?.audio?.time??null};
}

/** Seconds are an index-proven lower bound, never bytes divided by an assumed bitrate. */
export function cachedSecondsAhead(sample:SourceBufferAudit,position:number):number|null {
  return sample.cachedStartSeconds!==null&&sample.cachedEndSeconds!==null&&sample.cachedStartSeconds<=position
    ?Math.max(0,sample.cachedEndSeconds-position):null;
}

const reporters=new WeakMap<object,ReturnType<typeof setInterval>>();
export function startSourceBufferAudit(owner:object,source:object,publish:(sample:SourceBufferAudit)=>void,originSeconds=0):void {
  stopSourceBufferAudit(owner);resetBufferAudit(source);
  reporters.set(owner,setInterval(()=>{const sample=sourceBufferAudit(source);if(!sample)return;
    const titleTime=(time:number|null)=>time===null||!Number.isFinite(originSeconds)?null:time-originSeconds;
    publish({...sample,cachedStartSeconds:titleTime(sample.cachedStartSeconds),cachedEndSeconds:titleTime(sample.cachedEndSeconds),
      videoReadEndSeconds:titleTime(sample.videoReadEndSeconds),audioReadEndSeconds:titleTime(sample.audioReadEndSeconds)});
  },500));
}
export function stopSourceBufferAudit(owner:object):void {
  const timer=reporters.get(owner);if(timer!==undefined)clearInterval(timer);reporters.delete(owner);
}

const received=new WeakMap<object,{generation:number;sample:SourceBufferAudit}>();
export function recordDecoderBuffer(owner:object,generation:number,value:SourceBufferAudit):void {
  if(!Number.isSafeInteger(generation)||generation<1||!value||typeof value!=='object')return;
  const copy={} as SourceBufferAudit;
  for(const key of ['cacheBytes','cacheLimitBytes','readAheadLimitBytes','forwardBytes','cachedStartSeconds',
    'cachedEndSeconds','videoReadEndSeconds','audioReadEndSeconds'] as const){
    const number=value[key];if(number!==null&&(typeof number!=='number'||!Number.isFinite(number)||Math.abs(number)>Number.MAX_SAFE_INTEGER))return;
    Object.assign(copy,{[key]:number});
  }
  received.set(owner,{generation,sample:copy});
}
export function decoderBuffer(owner:object,generation:number|null):SourceBufferAudit|null {
  const entry=received.get(owner);return entry?.generation===generation?{...entry.sample}:null;
}
