import { configureEngineAssets } from '../../../vendor/webgpu-player/src/EngineAssets';
import { createCoreAudioOutput } from '../universal/audio/core-output';
import type { OriginalBackend, OriginalRuntimeOptions, UniversalReadout } from '../universal/loader';
import type { OriginalMedia } from '../universal/source';
import { CoreVideoPresenter } from './render/video-presenter';
import { PlaybackCore, type CoreState } from './runtime';
import type { AudioTrack } from './types';
import { canonicalAudioCodec } from '../universal/audio/packages';
import { VideoPackages } from '../universal/video/packages';
import { VideoDecoderRouter } from './decode/video';
export {SubtitleSession} from '../universal/subtitles/session';

/** Same native-view boundary; all orchestration beneath it belongs to Vela. */
export class UniversalRuntime implements OriginalBackend {
  readonly retainsSource=true;
  get supportsSubtitles(){return !!this.options.assets.subtitleBaseURL;}
  get byteReader(){return this.core.byteReader;}
  get sourceContainer(){return this.core.container;}
  get videoSize(){const track=this.core.snapshot().tracks.find(track=>track.kind==='video');return track?{width:track.width,height:track.height}:undefined;}
  private readonly core:PlaybackCore;
  private media?:OriginalMedia;
  private audioAliases=new Map<string,string>();
  private lastState:CoreState['state']='idle';
  private disposed=false;
  private disposing?:Promise<void>;
  private volume=1;
  private muted=false;
  private pendingAudio:string|null=null;
  private notes:string[]=[];
  constructor(private readonly options:OriginalRuntimeOptions){
    this.volume=options.surface.video.volume;this.muted=options.surface.video.muted;
    configureEngineAssets({baseURL:options.assets.baseURL,cacheKey:options.assets.assetKey});
    const presenter=new CoreVideoPresenter(options.surface,error=>this.failed(error));
    const packages=new VideoPackages(options.assets.videoDecoderURL);
    this.core=new PlaybackCore(presenter,audio=>createCoreAudioOutput({...audio,libraryBaseURL:options.assets.baseURL,
      assetKey:options.assets.assetKey,forceSoftware:options.retry?.audio}),state=>this.publish(state),(error,position)=>{
      if(!this.disposed)options.onFailure(error.message,position/1e6);
    },callbacks=>new VideoDecoderRouter(presenter,packages,callbacks,options.retry?.video));
    this.core.setVolume(this.volume,this.muted);
    options.signal.addEventListener('abort',this.abort,{once:true});
  }
  private readonly abort=()=>{void this.dispose();};
  private failed(error:Error){if(!this.disposed)this.options.onFailure(error.message,this.position);}
  private publish(state:CoreState){
    const audio=state.tracks.filter((track):track is AudioTrack=>track.kind==='audio');
    const descriptions=[...(this.media?.audio??[])].sort((a,b)=>a.streamIndex-b.streamIndex);
    this.audioAliases.clear();
    audio.forEach((track,index)=>this.audioAliases.set(descriptions[index]?.id??track.id,track.id));
    const note=(value:string)=>{if(this.notes.length<32&&!this.notes.includes(value))this.notes.push(value);};
    audio.forEach((track,index)=>{
      const description=descriptions[index];if(!description)return;
      if(canonicalAudioCodec(description.codec)!==track.codec)note('audio-description:codec');
      if(description.channels!==undefined&&description.channels!==track.channels)note('audio-description:channels');
      if(description.sampleRate!==undefined&&description.sampleRate!==track.sampleRate)note('audio-description:sample-rate');
      if(description.language&&track.language&&description.language!==track.language)note('audio-description:language');
    });
    if(state.tracks.length&&audio.length!==descriptions.length&&!this.notes.includes('audio-description:inventory-count'))this.notes.push('audio-description:inventory-count');
    const type=state.state==='playing'?'playing':state.state==='ended'?'ended':state.state==='loading'||state.state==='buffering'?'waiting':'statechange';
    if(state.state!==this.lastState){this.lastState=state.state;this.options.onEvent({type});}
  }
  get position(){return this.core.snapshot().positionUs/1e6;}
  get audioTrackIds(){return [...this.audioAliases.keys()];}
  get audioTracks(){
    const descriptions=[...(this.media?.audio??[])].sort((a,b)=>a.streamIndex-b.streamIndex);
    return this.core.snapshot().tracks.filter((track):track is AudioTrack=>track.kind==='audio').map((track,index)=>({
      id:[...this.audioAliases].find(([,actual])=>actual===track.id)?.[0]??track.id,
      label:descriptions[index]?.label??[track.language,track.codec.toUpperCase(),`${track.channels} ch`].filter(Boolean).join(' · '),
      language:track.language,codec:track.codec,channels:track.channels,
    }));
  }
  get pendingAudioTrackId(){return this.pendingAudio;}
  get readout():UniversalReadout{
    const state=this.core.snapshot();
    const audioTrackId=[...this.audioAliases].find(([,id])=>id===state.audioTrackId)?.[0]??state.audioTrackId;
    return {state:state.state==='idle'?'loading':state.state,position:state.positionUs/1e6,duration:state.durationUs===null?null:state.durationUs/1e6,
      frames:state.decoded,dropped:state.dropped,presentedFrames:state.presented,decoderReady:state.tracks.some(track=>track.kind==='video'),
      audioTrackId,metadataDiscrepancies:this.notes.slice(0,32)};
  }
  get presentationTelemetry(){return {presentedFrameCount:this.core.snapshot().presented};}
  async open(media:OriginalMedia){
    this.options.signal.throwIfAborted();this.media=media;
    const ordered=[...media.audio].sort((a,b)=>a.streamIndex-b.streamIndex);
    const ordinal=ordered.findIndex(track=>track.id===media.selectedAudioId);
    this.notes=['audio-selection:audio-ordinal'];
    if(media.hls)await this.core.openHls(media.url,media.position*1e6,Math.round(media.hls.originSeconds*1e6),Math.max(0,ordinal));
    else await this.core.open(media.url,media.position*1e6,Math.max(0,ordinal));
    this.core.setVolume(this.volume,this.muted);
  }
  pause(){this.core.pause();}
  resume(){void this.core.play().catch(error=>this.failed(error));}
  setVolume(volume:number){this.volume=volume;this.core.setVolume(volume,this.muted);}
  setMuted(muted:boolean){this.muted=muted;this.core.setVolume(this.volume,muted);}
  async setSpeed(value:number){this.core.setRate(value);}
  async selectAudio(trackId:string){
    const actual=this.audioAliases.get(trackId);if(!actual)throw new Error('Unknown actual audio track');
    this.pendingAudio=trackId;
    try{await this.core.selectAudio(actual);}finally{this.pendingAudio=null;}
  }
  async seek(position:number){await this.core.seek(position*1e6);}
  dispose():Promise<void>{if(this.disposing)return this.disposing;this.disposed=true;this.options.signal.removeEventListener('abort',this.abort);this.disposing=this.core.dispose();return this.disposing;}
}
