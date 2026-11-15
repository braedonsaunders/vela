import { abortable } from './async';
import { MediaClock } from './clock';
import { FileDemux } from './demux/file';
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
  decoded:number; presented:number; dropped:number; failure:string|null;
}
interface Epoch {
  id:number; abort:AbortController; demux:FileDemux; decoder:VideoBackend;
  firstFrame:Promise<void>; resolveFirst():void; videoEndUs:number; audioEndUs:number;
  videoEnded:boolean; audioEnded:boolean; audioTailReported:boolean; audioBufferedUntilUs:number;
}

/** Vela's direct-file orchestration. It deliberately has no upstream controller. */
export class PlaybackCore {
  readonly clock = new MediaClock();
  private readonly scheduler: VideoScheduler<CoreVideoFrame>;
  private source?: {abort:AbortController;reader:RangeReader;audio:AudioOutput};
  private epoch?:Epoch;
  private nextEpoch = 0;
  private state:CoreState['state']='idle';
  private tracks:MediaTrack[]=[];
  private video?:VideoTrack;
  private audio?:AudioTrack;
  private requestedAudioId?:string;
  private initialAudioOrdinal=0;
  private durationUs:number|null=null;
  private failure:string|null=null;
  private playing=true;
  private closed=false;
  private disposing?:Promise<void>;
  private volume=1;
  private muted=false;
  private rate=1;
  private decodedBeforeEpoch=0;
  private timer?:ReturnType<typeof setInterval>;

  constructor(private readonly presenter:CorePresenter,
    private readonly createAudio:(options:CoreAudioFactoryOptions)=>AudioOutput,
    private readonly onState:(state:CoreState)=>void,
    /** The host owns authorized decoder/conversion recovery after this route. */
    private readonly onFailure:(error:Error,positionUs:number)=>void,
    private readonly createVideo:(callbacks:VideoCallbacks)=>VideoBackend) {
    this.scheduler=new VideoScheduler(this.clock,(frame,position)=>presenter.present(frame,position),error=>this.fail(error),()=>{
      const run=this.epoch;if(!run)return;
      run.resolveFirst();
      this.state=this.playing?'playing':'paused';this.publish();
    });
  }

  snapshot():CoreState {
    return {state:this.state,epoch:this.epoch?.id??this.nextEpoch,positionUs:this.clock.time(),durationUs:this.durationUs,
      tracks:this.tracks,videoTrackId:this.video?.id??null,audioTrackId:this.audio?.id??null,
      decoded:this.decodedBeforeEpoch+(this.epoch?.decoder.metrics.decoded??0),presented:this.scheduler.metrics.presented,dropped:this.scheduler.metrics.dropped,failure:this.failure};
  }
  private publish(){this.onState(this.snapshot());}
  private current(run:Epoch){return this.epoch===run&&!run.abort.signal.aborted&&!this.closed;}

  async open(url:string,positionUs=0,audioOrdinal=0):Promise<void>{
    if(this.closed)throw new Error('Playback core is disposed');
    await this.closeSource();
    this.decodedBeforeEpoch=0;Object.assign(this.scheduler.metrics,{presented:0,dropped:0,preroll:0});
    const abort=new AbortController(),reader=new RangeReader(url);
    const audio=this.createAudio({signal:abort.signal,onClock:anchor=>{
      if(this.clock.update(anchor)){
        const run=this.epoch;
        if(run&&run.id===anchor.epoch){run.audioBufferedUntilUs=anchor.bufferedUntilUs;if(run.audioEnded)run.audioTailReported=true;}
        if(this.playing&&(this.state==='playing'||this.state==='buffering'))this.state=anchor.playing?'playing':'buffering';
        this.checkEnded();
      }
    },onFailure:failure=>{if(this.epoch?.id===failure.epoch)this.fail(new Error(`Audio ${failure.stage}: ${failure.message}`));}});
    this.source={abort,reader,audio};this.failure=null;this.tracks=[];this.video=undefined;this.audio=undefined;this.requestedAudioId=undefined;this.durationUs=null;
    this.initialAudioOrdinal=Number.isSafeInteger(audioOrdinal)&&audioOrdinal>=0?audioOrdinal:0;
    await this.startEpoch(positionUs);
  }

  private async startEpoch(positionUs:number):Promise<void>{
    const source=this.source;if(!source)throw new Error('Playback source is absent');
    if(!Number.isFinite(positionUs)||positionUs<0)throw new Error('Invalid seek target');
    this.decodedBeforeEpoch+=this.epoch?.decoder.metrics.decoded??0;
    this.epoch?.abort.abort();this.epoch?.decoder.dispose();this.epoch?.demux.dispose();
    source.audio.pause();
    const abort=new AbortController(),id=++this.nextEpoch;
    const signal=AbortSignal.any([source.abort.signal,abort.signal]);
    const demux=new FileDemux(source.reader,signal);
    let resolveFirst!:()=>void;
    const firstFrame=new Promise<void>(resolve=>{resolveFirst=resolve;});
    const run:Epoch={id,abort,demux,firstFrame,resolveFirst,videoEndUs:positionUs,audioEndUs:positionUs,videoEnded:false,audioEnded:false,audioTailReported:false,audioBufferedUntilUs:positionUs,
      decoder:this.createVideo({output:frame=>{if(this.current(run))this.scheduler.push(frame);else frame.release();},
        canOutput:()=>!this.scheduler.buffer.full,active:()=>this.playing,
        onFailure:error=>{if(this.current(run))this.fail(error);}})};
    this.epoch=run;this.scheduler.reset(id,positionUs,!this.playing);this.state='loading';this.failure=null;
    this.clock.reset(positionUs,id,!!this.audio);this.clock.setPlaying(false);this.publish();
    const startup=AbortSignal.any([signal,AbortSignal.timeout(8000)]);
    try{
      const metadata=await abortable(demux.open(startup),startup);
      if(!this.current(run))return;
      const video=metadata.tracks.find((track):track is VideoTrack=>track.kind==='video'&&track.id===this.video?.id)
        ?? metadata.tracks.find((track):track is VideoTrack=>track.kind==='video');
      if(!video)throw new Error('Source contains no video track');
      const audio=metadata.tracks.find((track):track is AudioTrack=>track.kind==='audio'&&track.id===(this.requestedAudioId??this.audio?.id))
        ?? metadata.tracks.filter((track):track is AudioTrack=>track.kind==='audio')[this.initialAudioOrdinal]
        ?? metadata.tracks.find((track):track is AudioTrack=>track.kind==='audio');
      const sameAudio=!!this.audio&&this.audio.id===audio?.id;
      this.tracks=metadata.tracks;this.video=video;this.audio=audio;this.durationUs=metadata.durationUs;
      this.clock.reset(positionUs,id,!!audio);
      await abortable(Promise.all([
        run.decoder.configure(video,id,startup),
        audio?(async()=>{if(!sameAudio)await source.audio.configure(audio,id,startup);if(sameAudio||positionUs!==0)await source.audio.flush(positionUs,id,startup);})():Promise.resolve(),
      ]),startup);
      if(!this.current(run))return;
      source.audio.setVolume(this.volume,this.muted);source.audio.setRate(this.rate);
      this.scheduler.start();
      void this.videoPackets(run,video,positionUs,signal);
      if(audio)void this.audioPackets(run,audio,positionUs,signal);else run.audioEnded=true;
      if(this.playing){if(audio)await abortable(source.audio.play(),startup);this.clock.setPlaying(true);}
      else source.audio.pause();
      await abortable(firstFrame,startup);
      if(this.current(run)){
        this.state=this.playing?'playing':'paused';this.publish();
        if(!this.timer)this.timer=setInterval(()=>{this.checkEnded();this.publish();},250);
      }
    }catch(error){if(this.current(run))this.fail(error);throw error;}
  }

  private async videoPackets(run:Epoch,track:VideoTrack,positionUs:number,signal:AbortSignal){
    try{
      for await(const packet of run.demux.packets(track.id,positionUs,run.id,signal)){
        if(!this.current(run))return;
        run.videoEndUs=Math.max(run.videoEndUs,packet.timestampUs+packet.durationUs);
        await run.decoder.decode(packet,signal);
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
  pause(){this.playing=false;this.clock.setPlaying(false);this.source?.audio.pause();if(this.state==='playing')this.state='paused';this.publish();}
  async play(){const run=this.epoch;this.playing=true;if(this.audio)await this.source?.audio.play();if(this.epoch!==run||this.closed)return;this.clock.setPlaying(true);this.scheduler.start();if(this.state==='paused')this.state='playing';this.publish();}
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
    source?.abort.abort();source?.reader.dispose();
    if(source)await abortable(source.audio.dispose(),AbortSignal.timeout(3500)).catch(()=>{});
  }
  dispose():Promise<void>{
    if(this.disposing)return this.disposing;
    this.closed=true;
    this.disposing=(async()=>{await this.closeSource();this.presenter.dispose();this.scheduler.dispose();})();
    return this.disposing;
  }
}
