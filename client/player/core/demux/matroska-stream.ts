import {EncodedPacket} from 'mediabunny';
import type {ByteReader} from '../types';
import type {MatroskaSubtitleStream} from './subtitle-stream';

const CLUSTER=0x1f43b675, SIMPLE=0xa3, GROUP=0xa0, TIMESTAMP=0xe7;
const LEVEL_ONE=new Set([CLUSTER,0x114d9b74,0x1549a966,0x1654ae6b,0x1c53bb6b,0x1941a469,0x1254c367,0x1043a770]);
const MAX_PACKET=16*1024*1024;
interface Element {id:number;start:number;data:number;end:number;unknown:boolean}
interface RawBlock {timestamp:number;duration:number;isKeyFrame:boolean;data:Uint8Array;lacing:number;decoded:boolean;postProcessed:boolean;mainAdditional:Uint8Array|null;otherAdditionals:{addId:number;data:Uint8Array}[]}
interface Segment {timestampFactor:number;codecDelay?:number;clusterSeekStartPos:number;dataStartPos:number;elementEndPos:number|null;deferredCuesPosition:number|null;idToTrack:Map<number,Track>}
/** Version-pinned bridge to metadata and codec/lacing components, never a controller. */
interface Track {id:number;codecDelay:number;defaultDuration:number|null;codecId:string|null;decodingInstructions:{scope:number;data:{type:string;algorithm?:number|null;settings?:Uint8Array|null}|null}[];
 info:{type:string;codec?:string|null;alphaMode?:boolean}|null;segment:Segment;cuePoints:{time:number;trackId:number;clusterPosition:number}[];
 demuxer:{segments:unknown[];input:{_rootSource:object};loadDeferredCues(segment:Segment):Promise<void>|null;expandLacedBlocks(blocks:RawBlock[],track:Track):RawBlock[];decodeBlockData(track:Track,data:Uint8Array):Uint8Array}}
interface Scope {metadata:boolean;prefetch:WeakMap<object,Promise<void>>;reader:ByteReader;signal:AbortSignal;startSeconds:number;subtitles?:MatroskaSubtitleStream;tracks:WeakMap<object,StreamingMatroskaTrack>;cues:WeakMap<object,Promise<void>>}
const scopes=new WeakMap<object,Scope>();
export function installMatroskaStreaming(source:object,reader:ByteReader,signal:AbortSignal,startSeconds:number,subtitles?:MatroskaSubtitleStream){
 const scope:Scope={metadata:true,reader,signal,startSeconds,subtitles,tracks:new WeakMap(),cues:new WeakMap(),prefetch:new WeakMap()};scopes.set(source,scope);
 return()=>{if(scopes.get(source)===scope)scopes.delete(source);};
}
function loadCues(scope:Scope,track:Track){
 let pending=scope.cues.get(track.segment);if(!pending){pending=(async()=>{await scope.prefetch.get(track.segment)?.catch(()=>{});scope.signal.throwIfAborted();await track.demuxer.loadDeferredCues(track.segment);})();scope.cues.set(track.segment,pending);void pending.catch(()=>{});}return pending;
}
/** Metadata has released the library's mutable parse context before this starts. */
export function preloadMatroskaStreaming(demuxer:Track['demuxer'],segment:Segment){
 const scope=scopes.get(demuxer.input._rootSource);if(!scope||scope.startSeconds<=0||scope.signal.aborted)return;
 if(segment.deferredCuesPosition===null||scope.prefetch.has(segment))return;
 const work=(async()=>{const step=new Step(scope,await scope.reader.size(scope.signal)),element=await step.element(segment.deferredCuesPosition!);
  if(element.id!==0x1c53bb6b||element.end-element.data>16*1024*1024)return;
  for(let at=element.data;at<element.end;at+=1024*1024)await step.read(at,Math.min(1024*1024,element.end-at));
 })();scope.prefetch.set(segment,work);void work.catch(()=>{});
}
export function streamingMatroskaTrack(value:unknown,packetType?:(codec:string,data:Uint8Array)=>string|null):StreamingMatroskaTrack|null{
 const track=value as Track,scope=track?.demuxer&&scopes.get(track.demuxer.input._rootSource);
 if(!scope||track.demuxer.segments.length!==1||!track.info||!['video','audio'].includes(track.info.type))return null;
 // Preserve the library path for formats whose packet postprocessing is not this bridge's job.
 if(track.info.type==='video'&&(!['avc','hevc'].includes(track.info.codec??'')||track.info.alphaMode||!(track.defaultDuration!==null&&track.defaultDuration>0)))return null;
 if(track.decodingInstructions.some(i=>i.data?.type!=='decompress'||i.data.algorithm!==3||i.scope&4))return null;
 let stream=scope.tracks.get(track as object);if(!stream){stream=new StreamingMatroskaTrack(scope,track);scope.tracks.set(track as object,stream);}if(packetType)stream.packetType=packetType;return stream;
}
function unsigned(bytes:Uint8Array){let value=0;for(const byte of bytes)value=value*256+byte;if(!Number.isSafeInteger(value))throw new Error('Matroska integer exceeds precision');return value;}
function vint(bytes:Uint8Array,at=0,id=false){
 const first=bytes[at];if(!first)throw new Error('Invalid Matroska integer');let length=1,marker=128;while(!(first&marker)){length++;marker>>=1;}
 if(length>8||at+length>bytes.length)throw new Error('Truncated Matroska integer');let value=id?first:first&(marker-1),unknown=!id&&value===marker-1;
 for(let i=1;i<length;i++){value=value*256+bytes[at+i];unknown&&=bytes[at+i]===255;}
 if(!unknown&&!Number.isSafeInteger(value))throw new Error('Matroska integer exceeds precision');return{value,length,unknown};
}
class Step {
 readonly signal:AbortSignal;private requested=0;private visits=0;private pages=new Set<number>();
 constructor(private scope:Scope,readonly size:number){this.signal=AbortSignal.any([scope.signal,AbortSignal.timeout(8000)]);}
 async read(offset:number,length:number){
  this.signal.throwIfAborted();if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0||offset+length>this.size||length>MAX_PACKET)throw new Error('Invalid Matroska streaming range');
  this.requested+=length;if(this.requested>32*1024*1024||++this.visits>65536)throw new Error('Matroska streaming search exceeds bound');
  for(let p=Math.floor(offset/262144);p<=Math.floor((offset+length-1)/262144);p++)this.pages.add(p);
  if(this.pages.size>128)throw new Error('Matroska streaming source coverage exceeds bound');
  const bytes=await this.scope.reader.read(offset,length,this.signal);this.signal.throwIfAborted();if(bytes.length!==length)throw new Error('Truncated Matroska streaming read');return bytes;
 }
 async element(at:number,limit=this.size):Promise<Element>{
  if(at>=limit)throw new Error('Matroska element outside parent');const bytes=await this.read(at,Math.min(12,limit-at)),id=vint(bytes,0,true),size=vint(bytes,id.length),data=at+id.length+size.length,end=size.unknown?limit:data+size.value;
  if(id.length>4||data>limit||!Number.isSafeInteger(end)||end>limit||end<data)throw new Error('Matroska element exceeds parent');return{id:id.value,start:at,data,end,unknown:size.unknown};
 }
}
interface Cursor {cluster:number;data:number;end:number;at:number;timestamp:number|null;remaining:{packet:EncodedPacket;cursor:Cursor}[]}
interface Result {set(value:{packet:EncodedPacket|null;provisional:boolean}):void}
interface Found {packet:EncodedPacket;cursor:Cursor}
/** Packets are acquired at block granularity. Cursors retain positions, not clusters. */
export class StreamingMatroskaTrack {
 private cursors=new WeakMap<EncodedPacket,Cursor>();
 packetType?: (codec:string,data:Uint8Array)=>string|null;
 constructor(private scope:Scope,private track:Track){}
 get sequential(){return this.track.info?.type==='video'||this.track.defaultDuration!==null&&this.track.defaultDuration>0;}
 get firstEnabled(){return this.scope.metadata||this.sequential;}
 private async step(){this.scope.signal.throwIfAborted();return new Step(this.scope,await this.scope.reader.size(this.scope.signal));}
 private async cursor(at:number,step:Step):Promise<Cursor>{
  const segment=this.track.segment,limit=segment.elementEndPos??step.size;
  if(!this.scope.metadata&&at<limit)this.scope.reader.prefetch?.(at,this.scope.signal);
  for(;at<limit;){const element=await step.element(at,limit);if(element.id===CLUSTER)return{cluster:at,data:element.data,end:element.end,at:element.data,timestamp:null,remaining:[]};if(element.unknown)throw new Error('Unknown-sized Matroska metadata');at=element.end;}
  return{cluster:limit,data:limit,end:limit,at:limit,timestamp:null,remaining:[]};
 }
 private async indexed(target:number,step:Step){
  if(target<=0)return{cursor:await this.cursor(this.track.segment.clusterSeekStartPos,step),cueTime:null as number|null,ticks:target*this.track.segment.timestampFactor+this.track.codecDelay};
  await loadCues(this.scope,this.track);step.signal.throwIfAborted();
  const ticks=target*this.track.segment.timestampFactor+this.track.codecDelay,cues=this.track.cuePoints;
  let low=0,high=cues.length;while(low<high){const mid=(low+high)>>>1;if(cues[mid].time<=ticks)low=mid+1;else high=mid;}
  const cue=low?cues[low-1]:undefined;
  return{cursor:await this.cursor(cue?.clusterPosition??this.track.segment.clusterSeekStartPos,step),cueTime:cue?.trackId===this.track.id?cue.time:null,ticks};
 }
 private packet(raw:RawBlock,position:number){
  let data=raw.decoded?raw.data:this.track.demuxer.decodeBlockData(this.track,raw.data);if(data.length>MAX_PACKET)throw new Error('Decoded Matroska packet exceeds bound');
  let key=raw.isKeyFrame;const codec=this.track.info!.codec;
  if(this.track.info!.type==='audio'&&codec){const actual=this.packetType?.(codec,data);if(actual)key=actual==='key';}
  const timestamp=(raw.timestamp-this.track.codecDelay)/this.track.segment.timestampFactor,duration=raw.duration/this.track.segment.timestampFactor;
  if(!Number.isFinite(timestamp)||!Number.isFinite(duration)||duration<0)throw new Error('Invalid Matroska streaming timestamp');
  return new EncodedPacket(data,key?'key':'delta',timestamp,duration,position,data.length,raw.otherAdditionals.length?{matroskaBlockAdditions:raw.otherAdditionals}:{});
 }
 private async block(element:Element,cursor:Cursor,step:Step,keyFrom?:number):Promise<RawBlock[]|null>{
  let block=element,duration=0,key=true,additions:{addId:number;data:Uint8Array}[]=[],additionalElements:Element[]=[];
  if(element.id===GROUP){
   let found:Element|undefined;
   for(let at=element.data;at<element.end;){const item=await step.element(at,element.end);if(item.unknown)throw new Error('Unknown-sized Matroska block group');
    if(item.id===0xa1)found=item;else if(item.id===0x9b)duration=unsigned(await step.read(item.data,item.end-item.data));else if(item.id===0xfb)key=false;
    else if(item.id===0x75a1)additionalElements.push(item);
    at=item.end;
   }
   if(!found)return null;block=found;
  }
  const header=await step.read(block.data,Math.min(12,block.end-block.data)),number=vint(header);
  if(header.length<number.length+3)throw new Error('Truncated Matroska block');
  const relative=new DataView(header.buffer,header.byteOffset+number.length,2).getInt16(0),flags=header[number.length+2],payload=block.data+number.length+3;
  const clusterTime=cursor.timestamp!,factor=this.track.segment.timestampFactor,actual=this.track.segment.idToTrack.get(number.value);
  const hint={position:cursor.cluster,payloadStart:cursor.data,length:cursor.end-cursor.data,time:clusterTime/factor,endTime:Math.max(clusterTime,clusterTime+relative+(actual?.defaultDuration??0))/factor,timestamp:clusterTime};
  this.scope.subtitles?.advance(hint);
  if(!actual?.info||!['video','audio'].includes(actual.info.type))this.scope.subtitles?.fragment(hint,element.start,element.end-element.start,number.value);
  if(number.value!==this.track.id)return null;
  if(element.id===SIMPLE)key=!!(flags&128);
  if(keyFrom!==undefined&&(!key||clusterTime+relative+1<keyFrom))return null;
  for(const item of additionalElements)for(let pos=item.data;pos<item.end;){const more=await step.element(pos,item.end);if(more.unknown)throw new Error('Unknown-sized Matroska block additions');
   if(more.id===0xa6){let id=1,data:Uint8Array|null=null;for(let p=more.data;p<more.end;){const part=await step.element(p,more.end);if(part.unknown)throw new Error('Unknown-sized Matroska block additional');if(part.id===0xee)id=unsigned(await step.read(part.data,part.end-part.data));if(part.id===0xa5)data=await step.read(part.data,part.end-part.data);p=part.end;}
    if(data&&id!==1){if(additions.length>=64)throw new Error('Matroska block additions exceed bound');additions.push({addId:id,data});}}
   pos=more.end;
  }
  const lacing=(flags>>1)&3;
  const raw:RawBlock={timestamp:clusterTime+relative,duration:duration||(lacing===0?Math.round(this.track.defaultDuration??0):0),isKeyFrame:key,data:await step.read(payload,block.end-payload),lacing,decoded:this.track.decodingInstructions.length===0,postProcessed:false,mainAdditional:null,otherAdditionals:additions};
  return this.track.demuxer.expandLacedBlocks([raw],this.track);
 }
 private async next(cursor:Cursor,step:Step,keyFrom?:number):Promise<Found|null>{
  if(cursor.remaining.length)return cursor.remaining[0];
  const limit=this.track.segment.elementEndPos??step.size;
  while(cursor.at<limit){
   if(cursor.at>=cursor.end){cursor=await this.cursor(cursor.end,step);if(cursor.at>=limit)return null;}
   const item=await step.element(cursor.at,cursor.end);
   if(cursor.timestamp!==null&&LEVEL_ONE.has(item.id)){cursor=await this.cursor(item.start,step);continue;}
   cursor={...cursor,at:item.end,remaining:[]};
   if(item.id===TIMESTAMP){cursor.timestamp=unsigned(await step.read(item.data,item.end-item.data));continue;}
   if(item.id!==SIMPLE&&item.id!==GROUP)continue;if(cursor.timestamp===null)throw new Error('Matroska block precedes cluster timestamp');
   const blocks=await this.block(item,cursor,step,keyFrom);if(!blocks)continue;
   const found=blocks.map((raw,index):Found=>({packet:this.packet(raw,item.start+index),cursor:{...cursor,remaining:[]}}));
   // Each lace cursor owns only its successors within this bounded block.
   for(let i=0;i<found.length;i++){found[i].cursor.remaining=found.slice(i+1);this.cursors.set(found[i].packet,found[i].cursor);}
   return found[0]??null;
  }
  return null;
 }
 async first(result:Result){const step=await this.step(),found=await this.next(await this.cursor(this.track.segment.clusterSeekStartPos,step),step);return result.set({packet:found?.packet??null,provisional:false});}
 async key(result:Result,target:number){
  const step=await this.step(),start=await this.indexed(target,step);let cursor=start.cursor;
  for(;;){const found=await this.next(cursor,step,start.cueTime??-Infinity);if(!found)return result.set({packet:null,provisional:false});cursor=found.cursor;
   const ticks=found.packet.timestamp*this.track.segment.timestampFactor+this.track.codecDelay;
   if(found.packet.type==='key'&&ticks<=start.ticks&&(start.cueTime===null||ticks+1>=start.cueTime))return result.set({packet:found.packet,provisional:false});
   if(ticks>start.ticks&&found.packet.type==='key'){
    if(start.cursor.cluster!==this.track.segment.clusterSeekStartPos){start.cursor=await this.cursor(this.track.segment.clusterSeekStartPos,step);start.cueTime=null;cursor=start.cursor;continue;}
    return result.set({packet:null,provisional:false});
   }
  }
 }
 async at(result:Result,target:number){
  const step=await this.step(),start=await this.indexed(target,step);let cursor=start.cursor,previous:EncodedPacket|null=null;
  for(;;){const found=await this.next(cursor,step);if(!found)return result.set({packet:previous,provisional:false});cursor=found.cursor;
   if(found.packet.timestamp>target)return result.set({packet:previous??found.packet,provisional:false});previous=found.packet;
   if(found.packet.timestamp+found.packet.duration>target)return result.set({packet:found.packet,provisional:false});
  }
 }
 owns(packet:EncodedPacket){return this.cursors.has(packet);}
 async after(result:Result,packet:EncodedPacket,keyOnly=false){
  const step=await this.step();let cursor=this.cursors.get(packet);if(!cursor)throw new Error('Matroska packet belongs to a retired cursor');
  for(;;){const found=await this.next(cursor,step,keyOnly?-Infinity:undefined);if(!found)return result.set({packet:null,provisional:false});cursor=found.cursor;if(!keyOnly||found.packet.type==='key')return result.set({packet:found.packet,provisional:false});}
 }
}

function rawTrack(value:unknown){const backing=(value as {_backing?:unknown})?._backing??value;return(backing as {internalTrack?:Track})?.internalTrack;}
export function hasStreamingMatroskaBacking(value:unknown){return !!streamingMatroskaTrack(rawTrack(value))?.sequential;}
export function primeMatroskaIndex(backing:unknown){
 const track=rawTrack(backing);
 const scope=track?.demuxer&&scopes.get(track.demuxer.input._rootSource);
 return scope&&scope.startSeconds>0&&track.demuxer.segments.length===1?loadCues(scope,track):undefined;
}
export function finishMatroskaMetadata(source:object){const scope=scopes.get(source);if(scope)scope.metadata=false;}

