import {abortable} from '../../core/async';
import {paintPGS,type SubtitleViewport} from './canvas';
import {MatroskaSubtitles} from './matroska';
import {PGSDecoder,type PGSDisplay} from './pgs';
import type {SubtitleClusterStream,SubtitleStreamPacket} from './types';

interface Surface {canvas:HTMLCanvasElement;resize():boolean;viewport():SubtitleViewport}
/** Selected-track stream only: no subtitle index, file scan or private byte cache. */
export async function streamingPGS(options:{container:MatroskaSubtitles;trackId:string;stream:SubtitleClusterStream;
  surface:Surface;position:number;clock():number;signal:AbortSignal;onFailure(error:unknown):void}){
  const {container,trackId,stream,surface,signal}=options;
  const context=surface.canvas.getContext('2d');if(!context)throw new Error('Subtitle overlay canvas unavailable');
  const local=new AbortController(),lifetime=AbortSignal.any([signal,local.signal]);
  const startup=AbortSignal.any([lifetime,AbortSignal.timeout(8000)]);
  let epoch=stream.epoch,decoder=new PGSDecoder(),active:PGSDisplay|null=null,drawn:PGSDisplay|null=null;
  let queue:SubtitleStreamPacket[]=[],queuedBytes=0,displays:PGSDisplay[]=[],displayBytes=0,lastTime=-Infinity;
  let replayed=false,working=false,ready=false,disposed=false,acquired=false,acquireAt=performance.now();
  const seen=new Map<number,number>();
  let resolve!:()=>void,reject!:(error:unknown)=>void;
  const first=new Promise<void>((yes,no)=>{resolve=yes;reject=no});void first.catch(()=>{});
  const bytes=(display:PGSDisplay)=>display.bitmaps.reduce((sum,bitmap)=>sum+bitmap.rgba.byteLength,0);
  const reset=()=>{decoder.reset();decoder=new PGSDecoder();active=null;drawn=null;queue=[];queuedBytes=0;displays=[];displayBytes=0;lastTime=-Infinity;seen.clear();acquired=false;acquireAt=performance.now();context.clearRect(0,0,surface.canvas.width,surface.canvas.height)};
  const failed=(error:unknown)=>{if(lifetime.aborted||disposed)return;reject(error);if(ready)options.onFailure(error)};
  const pump=async()=>{
    if(working||!replayed||disposed)return;working=true;
    try{
      while(queue.length){
        lifetime.throwIfAborted();queue.sort((a,b)=>a.time-b.time||a.position-b.position);
        const raw=queue.shift()!;queuedBytes-=raw.data.length;const attempt=epoch;
        if(raw.time<lastTime)continue;
        const packet=await container.decodeStreamPacket(trackId,raw,lifetime);
        lifetime.throwIfAborted();if(attempt!==epoch)continue;
        let output:PGSDisplay[];
        try{output=decoder.push(packet.data,packet.time)}catch(error){
          // A bounded seek may start in the middle of an object. Wait for a
          // complete display, never paint a partially reconstructed bitmap.
          if(!acquired&&error instanceof Error&&error.message==='PGS continuation has no object'){decoder.reset();continue}
          throw error;
        }
        lastTime=packet.time;
        for(const display of output){
          displayBytes+=bytes(display);if(displayBytes>64*1024*1024||displays.length>=256)throw new Error('Subtitle display look-ahead exceeds bound');
          displays.push(display);acquired=true;resolve();
        }
      }
    }catch(error){failed(error)}finally{working=false;if(queue.length&&!lifetime.aborted&&!disposed)void pump();}
  };
  const stop=stream.subscribe(cluster=>{
    if(lifetime.aborted||disposed)return;
    try{
      if(cluster.epoch!==epoch){epoch=cluster.epoch;reset()}
      const now=options.clock();if(cluster.time>now+8)return;
      for(const packet of container.streamPackets(trackId,cluster.bytes,cluster.payloadStart)){
        if(cluster.endTime<now-4&&packet.time<now-4)continue;
        if(seen.has(packet.position))continue;seen.set(packet.position,packet.time);
        if(seen.size>1024){const floor=options.clock()-30;for(const [position,time]of seen)if(time<floor)seen.delete(position);}
        queuedBytes+=packet.data.length;if(queuedBytes>16*1024*1024||queue.length>=8192||seen.size>65536)throw new Error('Streaming subtitle queue exceeds bound');
        queue.push(packet);
      }
      void pump();
    }catch(error){failed(error)}
  },failed,container.tracks.find(track=>track.id===trackId)?.containerTrackId??undefined);
  const dispose=()=>{if(disposed)return;disposed=true;stop();local.abort();signal.removeEventListener('abort',dispose);reset();surface.canvas.remove()};
  signal.addEventListener('abort',dispose,{once:true});
  try{
    await stream.replay(options.position,startup);startup.throwIfAborted();replayed=true;void pump();
    await abortable(first,startup);startup.throwIfAborted();ready=true;
    return {canvas:surface.canvas,end:Infinity,dispose,render:(time:number)=>{
      if(disposed)return;const resized=surface.resize();
      if(!acquired&&performance.now()-acquireAt>8000)throw new Error('Exact streaming PGS acquisition is unavailable');
      while(displays.length&&displays[0].time<=time){const next=displays.shift()!;displayBytes-=bytes(next);active=next;}
      if(drawn!==active||resized){context.clearRect(0,0,surface.canvas.width,surface.canvas.height);if(active)paintPGS(context,active,surface.viewport());drawn=active;}
    }};
  }catch(error){dispose();throw error}
}
