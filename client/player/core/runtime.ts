import {playbackMark} from '../timing';
import { abortable } from './async';
import { MediaClock } from './clock';
import {bufferedPackets} from './packet-buffer';
import { FileDemux,type PacketDemux } from './demux/file';
import { HlsDemux } from './demux/hls';
import { SegmentReader } from './source/segments';
import type { CoreVideoFrame,VideoBackend,VideoCallbacks } from './decode/video';
import { VideoScheduler } from './scheduler';
import { RangeReader } from './source/ranges';
import type { AudioClockAnchor, AudioOutput, AudioTrack, MediaTrack, VideoTrack } from './types';

export interface CorePresenter {
  present(frame: CoreVideoFrame, positionUs: number): boolean;
  dispose(): void;
}
export interface CoreAudioFactoryOptions {
  signal: AbortSignal;
  onClock(anchor: AudioClockAnchor): void;
  onFailure(failure: {epoch:number;trackId:string;stage:'native'|'software'|'output';message:string}): void;
}
export interface CoreState {
  state:'idle'|'loading'|'playing'|'paused'|'buffering'|'ended'|'failed';
  epoch:number; positionUs:number; durationUs:number|null;
  tracks:readonly MediaTrack[]; videoTrackId:string|null; audioTrackId:string|null;
  bufferAheadSeconds:number|null;readAheadSeconds:number|null;throughputBps:number|null;throughputHistory:number[];
  decoded:number; presented:number; dropped:number; failure:string|null;diagnostics:string[];
}
interface Epoch {
  id:number; abort:AbortController; demux:PacketDemux; decoder:VideoBackend;
  firstFrame:Promise<void>; resolveFirst():void; primed:Promise<void>; resolvePrimed():void; started:boolean; readAheadEndUs:number;videoEndUs:number; audioEndUs:number;
  videoEnded:boolean; audioEnded:boolean; audioTailReported:boolean; audioBufferedUntilUs:number;
}

export interface CoreLiveOptions {windowStartSeconds?:number;targetSeconds:number;startAtEdge:boolean}
type SourceState={abort:AbortController;audio:AudioOutput}&({kind:'file';reader:RangeReader}|{kind:'hls';segments:SegmentReader;originUs:number;live?:CoreLiveOptions});

/** One packet/decode/clock pipeline; transports never choose a scheduler. */
export class PlaybackCore {
  readonly clock = new MediaClock();
  private readonly scheduler: VideoScheduler<CoreVideoFrame>;
  private source?:SourceState;
  private epoch?:Epoch;
  private nextEpoch = 0;
  private state:CoreState['state']='idle';
  private tracks:MediaTrack[]=[];
  private video?:VideoTrack;
  private audio?:AudioTrack;
  private requestedAudioId?:string;
  private initialAudioOrdinal=0;
  private durationUs:number|null=null;
  private containerName='';
  private failure:string|null=null;
  private playing=true;
  private closed=false;
  private disposing?:Promise<void>;
  private volume=1;
  private muted=false;
  private rate=1;
  private decodedBeforeEpoch=0;
  private timer?:ReturnType<typeof setInterval>;
  private lastPresentationAt=0;
  private epochStartedAt=0;
  private rotating=false;

  constructor(private readonly presenter:CorePresenter,
    private readonly createAudio:(options:CoreAudioFactoryOptions)=>AudioOutput,
    private readonly onState:(state:CoreState)=>void,
    /** The host owns authorized decoder/conversion recovery after this route. */
    private readonly onFailure:(error:Error,positionUs:number)=>void,
    private readonly createVideo:(callbacks:VideoCallbacks)=>VideoBackend,
    private readonly mediaRequests?:import('../media-auth').MediaRequestPolicy) {
    this.scheduler=new VideoScheduler(this.clock,(frame,position)=>presenter.present(frame,position),error=>this.fail(error),()=>{
      const run=this.epoch;if(!run)return;
      this.lastPresentationAt=performance.now();run.resolveFirst();
      if(run.started){this.state=this.playing?'playing':'paused';this.publish();}
    });
  }

  snapshot():CoreState {
    const position=this.clock.time(),run=this.epoch;
    const videoEnd=this.scheduler.bufferedEnd(position);
    const bufferedEnd=this.audio?Math.min(videoEnd,run?.audioBufferedUntilUs??position):videoEnd;
    const network=this.source?.kind==='file'?this.source.reader.bandwidth:this.source?.segments.bandwidth;
    return {readAheadSeconds:run?Math.max(0,(run.readAheadEndUs-position)/1e6):null,diagnostics:run?.demux.diagnostics.slice()??[],bufferAheadSeconds:run?Math.max(0,(bufferedEnd-position)/1e6):null,throughputBps:network?.bps??null,throughputHistory:network?.history??[],state:this.state,epoch:this.epoch?.id??this.nextEpoch,positionUs:this.clock.time(),durationUs:this.durationUs,
      tracks:this.tracks,videoTrackId:this.video?.id??null,audioTrackId:this.audio?.id??null,
      decoded:this.decodedBeforeEpoch+(this.epoch?.decoder.metrics.decoded??0),presented:this.scheduler.metrics.presented,dropped:this.scheduler.metrics.dropped,failure:this.failure};
  }
  get presentationTelemetry(){return {lastPresentationLagUs:this.scheduler.metrics.lastLagUs,maxPresentationLagUs:this.scheduler.metrics.maxLagUs,dropEvents:this.scheduler.dropEvents.map(value=>({...value}))};}
  get byteReader(){return this.source?.kind==='file'?this.source.reader:undefined;}
  get container(){return this.containerName;}
  get live(){const source=this.source;if(source?.kind!=='hls'||!source.live||!source.segments.liveWindow)return undefined;
    const window=source.segments.liveWindow;return {startSeconds:window.start,edgeSeconds:window.edge,segmentSeconds:window.targetDuration,
      ended:window.ended,retries:source.segments.networkRetries,retrying:source.segments.retrying,
      delivery:window.gap?'upstream-gap' as const:source.segments.retrying?'segment-delayed' as const:this.state==='buffering'?'waiting-for-publication' as const:'available' as const};
  }
  private publish(){this.onState(this.snapshot());}
  private current(run:Epoch){return this.epoch===run&&!run.abort.signal.aborted&&!this.closed;}

  open(url:string,positionUs=0,audioOrdinal=0):Promise<void>{return this.openSource({kind:'file',url},positionUs,audioOrdinal);}
  openHls(url:string,positionUs:number,originUs:number,audioOrdinal=0,authority?:{sourceGeneration:number;seekGeneration:number},live?:CoreLiveOptions):Promise<void>{
    if(!Number.isSafeInteger(originUs)||originUs<0||!live&&positionUs<originUs)throw new Error('Invalid HLS source timeline');
    return this.openSource({kind:'hls',url,originUs,cacheIdentity:authority?`${authority.sourceGeneration}:${authority.seekGeneration}`:`local:${this.nextEpoch+1}`,live},positionUs,audioOrdinal);
  }
  private async openSource(input:{kind:'file';url:string}|{kind:'hls';url:string;originUs:number;cacheIdentity:string;live?:CoreLiveOptions},positionUs:number,audioOrdinal:number):Promise<void>{
    if(this.closed)throw new Error('Playback core is disposed');
    await this.closeSource();
    this.decodedBeforeEpoch=0;this.scheduler.dropEvents.length=0;Object.assign(this.scheduler.metrics,{presented:0,dropped:0,preroll:0,lastLagUs:0,maxLagUs:0});
    const abort=new AbortController();
    const audio=this.createAudio({signal:abort.signal,onClock:anchor=>{
      if(this.clock.update(anchor)){
        const run=this.epoch;
        if(run&&run.id===anchor.epoch){run.audioBufferedUntilUs=anchor.bufferedUntilUs;if(run.audioEnded)run.audioTailReported=true;}
        if(this.playing&&(this.state==='playing'||this.state==='buffering'))this.state=anchor.playing?'playing':'buffering';
        this.checkEnded();
      }
    },onFailure:failure=>{if(this.epoch?.id===failure.epoch)this.fail(new Error(`Audio ${failure.stage}: ${failure.message}`));}});
    const allowed=this.mediaRequests?.allows.bind(this.mediaRequests);
    const source:SourceState=input.kind==='file'?{kind:'file',abort,audio,reader:new RangeReader(input.url,this.mediaRequests?.fetch,allowed)}:{kind:'hls',abort,audio,segments:new SegmentReader(input.url,this.mediaRequests?.fetch,allowed,input.cacheIdentity,!!input.live),originUs:input.originUs,live:input.live};
    this.source=source;this.failure=null;this.tracks=[];this.video=undefined;this.audio=undefined;this.requestedAudioId=undefined;this.durationUs=null;
    this.initialAudioOrdinal=Number.isSafeInteger(audioOrdinal)&&audioOrdinal>=0?audioOrdinal:0;
    try{
      const deadline=performance.now()+8000;
      if(source.kind==='hls'){
        this.state='loading';this.clock.reset(positionUs,++this.nextEpoch,false);this.publish();
        await source.segments.prepare(AbortSignal.any([abort.signal,AbortSignal.timeout(8000)]));
        if(this.source!==source||this.closed)return;
        if(source.live&&source.segments.liveWindow){const window=source.segments.liveWindow;
          positionUs=source.live.startAtEdge?Math.max(window.start,window.edge-source.live.targetSeconds)*1e6:
            Math.max(window.start,Math.min(window.edge-0.05,positionUs/1e6))*1e6;
        }
      }
      await this.startEpoch(positionUs,deadline);
    }catch(error){if(this.source===source&&!abort.signal.aborted)this.fail(error);throw error;}
  }

  private async startEpoch(positionUs:number,deadline=performance.now()+8000):Promise<void>{
    const source=this.source;if(!source)throw new Error('Playback source is absent');
    if(!Number.isFinite(positionUs)||positionUs<0)throw new Error('Invalid seek target');
    this.decodedBeforeEpoch+=this.epoch?.decoder.metrics.decoded??0;
    this.epoch?.abort.abort();this.epoch?.decoder.dispose();this.epoch?.demux.dispose();
    source.audio.pause();
    const abort=new AbortController(),id=++this.nextEpoch;
    const signal=AbortSignal.any([source.abort.signal,abort.signal]);
    const demux:PacketDemux=source.kind==='file'?new FileDemux(source.reader,signal):new HlsDemux(source.segments,signal,source.originUs);
    let resolveFirst!:()=>void,resolvePrimed!:()=>void;
    const firstFrame=new Promise<void>(resolve=>{resolveFirst=resolve;});
    const primed=new Promise<void>(resolve=>{resolvePrimed=resolve;});
    const run:Epoch={id,abort,demux,firstFrame,resolveFirst,primed,resolvePrimed,started:false,readAheadEndUs:positionUs,videoEndUs:positionUs,audioEndUs:positionUs,videoEnded:false,audioEnded:false,audioTailReported:false,audioBufferedUntilUs:positionUs,
      decoder:this.createVideo({output:frame=>{if(this.current(run)){const eligible=frame.timestampUs+frame.durationUs>positionUs;this.scheduler.push(frame);if(eligible)run.resolvePrimed();}else frame.release();},
        canOutput:()=>!this.scheduler.buffer.full,active:()=>this.playing,
        onFailure:error=>{if(this.current(run))this.fail(new Error(`Video decode: ${error.message}`));}})};
    this.epoch=run;this.epochStartedAt=performance.now();this.lastPresentationAt=performance.now();this.scheduler.reset(id,positionUs,!this.playing);this.state='loading';this.failure=null;
    this.clock.reset(positionUs,id,!!this.audio);this.clock.setPlaying(false);this.publish();
    const startup=AbortSignal.any([signal,AbortSignal.timeout(Math.max(0,Math.ceil(deadline-performance.now())))]);
    try{
      playbackMark('metadata:start');
      const metadata=await abortable(demux.open(startup),startup);
      playbackMark('metadata:ready');
      if(!this.current(run))return;
      const video=metadata.tracks.find((track):track is VideoTrack=>track.kind==='video'&&track.id===this.video?.id)
        ?? metadata.tracks.find((track):track is VideoTrack=>track.kind==='video');
      if(!video)throw new Error('Source contains no video track');
      const audio=metadata.tracks.find((track):track is AudioTrack=>track.kind==='audio'&&track.id===(this.requestedAudioId??this.audio?.id))
        ?? metadata.tracks.filter((track):track is AudioTrack=>track.kind==='audio')[this.initialAudioOrdinal]
        ?? metadata.tracks.find((track):track is AudioTrack=>track.kind==='audio');
      const sameAudio=!!this.audio&&!!audio&&sameAudioConfiguration(this.audio,audio);
      this.tracks=metadata.tracks;this.video=video;this.audio=audio;this.durationUs=source.kind==='hls'&&source.live?null:metadata.durationUs;this.containerName=metadata.container;
      this.clock.reset(positionUs,id,!!audio);
      playbackMark('decode:start');
      await abortable(Promise.all([
        run.decoder.configure(video,id,startup),
        audio?(async()=>{if(!sameAudio)await source.audio.configure(audio,id,startup);if(sameAudio||positionUs!==0)await source.audio.flush(positionUs,id,startup);})():Promise.resolve(),
      ]),startup);
      if(!this.current(run))return;
      playbackMark('decode:ready');
      source.audio.setVolume(this.volume,this.muted);source.audio.setRate(this.rate);
      void this.videoPackets(run,video,positionUs,signal);
      if(audio)void this.audioPackets(run,audio,positionUs,signal);else run.audioEnded=true;
      // Decode the target frame before starting the physical audio clock. Otherwise
      // decoder/pipeline setup latency is mistaken for late video and drops it.
      await abortable(primed,startup);
      if(!this.current(run))return;
      this.scheduler.start();
      if((this.scheduler.buffer.nextTimestampUs??Infinity)<=positionUs)await abortable(firstFrame,startup);
      if(this.playing&&audio)await abortable(source.audio.play(),startup);
      if(!this.current(run))return;
      if(this.playing)this.clock.setPlaying(true);else source.audio.pause();
      run.started=true;
      await abortable(firstFrame,startup);
      if(this.current(run)){
        this.state=this.playing?'playing':'paused';this.publish();
        if(!this.timer)this.timer=setInterval(()=>{this.checkLive();this.checkEnded();this.publish();},250);
      }
    }catch(error){if(this.current(run))this.fail(error);throw error;}
  }

  private async videoPackets(run:Epoch,track:VideoTrack,positionUs:number,signal:AbortSignal){
    try{
      for await(const packet of bufferedPackets(run.demux.packets(track.id,positionUs,run.id,signal),signal,end=>{if(this.current(run))run.readAheadEndUs=end;})){
        if(!this.current(run))return;
        run.videoEndUs=Math.max(run.videoEndUs,packet.timestampUs+packet.durationUs);
        try{await run.decoder.decode(packet,signal);}catch(error){throw new Error(`Video decode: ${error instanceof Error?error.message:'decoder failed'}`);}
      }
      await run.decoder.drain(signal);if(!this.current(run))return;run.videoEnded=true;this.checkEnded();
    }catch(error){if(this.current(run))this.fail(error);}
  }
  private async audioPackets(run:Epoch,track:AudioTrack,positionUs:number,signal:AbortSignal){
    const audio=this.source!.audio;
    try{
      for await(const packet of run.demux.packets(track.id,positionUs,run.id,signal)){
        if(!this.current(run))return;
        run.audioEndUs=Math.max(run.audioEndUs,packet.timestampUs+packet.durationUs);
        await audio.decode(packet,signal);
      }
      await audio.drain?.(signal);if(!this.current(run))return;run.audioEnded=true;this.checkEnded();
    }catch(error){if(this.current(run))this.fail(error);}
  }
  private checkLive(){
    const source=this.source,run=this.epoch;
    if(source?.kind!=='hls'||!source.live||!run||!this.playing||this.state==='failed'||this.state==='ended')return;
    const now=performance.now();
    if(now-this.lastPresentationAt>10000){this.fail(new Error('Live publication produced no frame for 10 seconds'));return;}
    // The demux library retains its segment census. Recreate that library-only
    // epoch periodically over our SAME bounded reader/clock to cap metadata.
    if(!this.rotating&&this.state==='playing'&&now-this.epochStartedAt>180000){
      this.rotating=true;void this.seek(this.clock.time()).catch(()=>{}).finally(()=>{this.rotating=false;});
    }
  }
  private checkEnded(){
    const run=this.epoch;if(!run||!this.current(run)||!run.videoEnded||!run.audioEnded||this.scheduler.buffer.length)return;
    if(this.audio&&!run.audioTailReported)return;
    const end=this.audio?run.audioBufferedUntilUs:run.videoEndUs;
    if(this.clock.time()+1000<end)return;
    this.clock.setPlaying(false);this.source?.audio.pause();this.scheduler.stop();this.state='ended';this.publish();
  }
  async seek(positionUs:number){await this.startEpoch(positionUs);}
  async selectAudio(trackId:string){
    const track=this.tracks.find((track):track is AudioTrack=>track.kind==='audio'&&track.id===trackId);
    if(!track)throw new Error('Unknown actual audio track');
    const position=this.clock.time();this.requestedAudioId=track.id;
    await this.startEpoch(position);
  }
  pause(){this.playing=false;this.scheduler.setPreview(true);this.clock.setPlaying(false);this.source?.audio.pause();if(this.state==='playing')this.state='paused';this.publish();}
  async play(){this.playing=true;
    const source=this.source,window=source?.kind==='hls'&&source.live?source.segments.liveWindow:undefined;
    if(window&&this.clock.time()<window.start*1e6){await this.seek(Math.max(window.start,window.edge-(source as Extract<SourceState,{kind:'hls'}>).live!.targetSeconds)*1e6);return;}
    const run=this.epoch;this.scheduler.setPreview(false);if(this.state==='loading'){this.publish();return;}if(this.audio)await this.source?.audio.play();if(this.epoch!==run||this.closed||!this.playing)return;this.clock.setPlaying(true);this.scheduler.start();if(this.state==='paused')this.state='playing';this.publish();}
  setLiveTarget(seconds:number){if(this.source?.kind==='hls'&&this.source.live&&Number.isFinite(seconds)&&seconds>0&&seconds<=120)this.source.live.targetSeconds=seconds;}
  setVolume(volume:number,muted:boolean){if(!Number.isFinite(volume)||volume<0||volume>1)throw new Error('Invalid volume');this.volume=volume;this.muted=muted;this.source?.audio.setVolume(volume,muted);}
  setRate(rate:number){if(!Number.isFinite(rate)||rate<0.5||rate>2)throw new Error('Unsupported playback speed');this.rate=rate;this.source?.audio.setRate(rate);this.clock.setRate(rate);}
  private fail(error:unknown){
    if(this.state==='failed'||this.closed)return;
    const failure=error instanceof Error?error:new Error(String(error));const position=this.clock.time();
    this.state='failed';this.failure=failure.message;this.clock.setPlaying(false);this.source?.audio.pause();
    this.epoch?.abort.abort();this.epoch?.decoder.dispose();this.scheduler.stop();this.scheduler.buffer.clear();
    if(this.timer)clearInterval(this.timer);this.timer=undefined;
    this.publish();this.onFailure(failure,position);
  }
  private async closeSource(){
    if(this.timer)clearInterval(this.timer);this.timer=undefined;
    const source=this.source;this.source=undefined;
    this.epoch?.abort.abort();this.epoch?.decoder.dispose();this.epoch?.demux.dispose();this.epoch=undefined;
    this.scheduler.stop();this.scheduler.buffer.clear();this.clock.setPlaying(false);
    source?.abort.abort();if(source?.kind==='file')source.reader.dispose();else source?.segments.dispose();
    if(source)await abortable(source.audio.dispose(),AbortSignal.timeout(3500)).catch(()=>{});
  }
  dispose():Promise<void>{
    if(this.disposing)return this.disposing;
    this.closed=true;
    this.disposing=(async()=>{await this.closeSource();this.presenter.dispose();this.scheduler.dispose();})();
    return this.disposing;
  }
}

function sameAudioConfiguration(a:AudioTrack,b:AudioTrack):boolean{
  if(a.id!==b.id||a.codec!==b.codec||a.sampleRate!==b.sampleRate||a.channels!==b.channels||a.channelMask!==b.channelMask||a.config?.codec!==b.config?.codec)return false;
  const bytes=(value:AudioTrack)=>value.codecPrivate??(value.config?.description?ArrayBuffer.isView(value.config.description)?new Uint8Array(value.config.description.buffer,value.config.description.byteOffset,value.config.description.byteLength):new Uint8Array(value.config.description):null);
  const x=bytes(a),y=bytes(b);return x===y||!!x&&!!y&&x.length===y.length&&x.every((value,i)=>value===y[i]);
}
