import type {AudioOutput,AudioTrack,EncodedPacket,AudioClockAnchor,AudioBufferState} from '../../core/types';
import AudioWorkletController from '../../../../vendor/webgpu-player/src/audio/output/AudioWorkletController';
import CustomDecodeAudioBridge from '../../../../vendor/webgpu-player/src/audio/output/CustomDecodeAudioBridge';
import AudioDecodeWorkerClient,{AudioDecodeWorkerPacketBatchBuilder,type AudioDecodeWorkerAttempt} from '../../../../vendor/webgpu-player/src/pipeline/AudioDecodeWorkerClient';
import type {AudioDecodeWorkerInputBatch,AudioDecodeWorkerPCMSample} from '../../../../vendor/webgpu-player/src/pipeline/AudioDecodeWorkerProtocol';
import type {AudioWorkletTelemetry} from '../../../../vendor/webgpu-player/src/audio/output/AudioWorkletProtocol';
import {configureCustomAudioDestination} from '../../../../vendor/webgpu-player/src/audio/NativeMultichannelAudioOutput';
import {requireMicroseconds} from '../../../../vendor/webgpu-player/src/TimeMath';
import {getQualifiedCustomWaveChannelLayout} from '../../../../vendor/webgpu-player/src/audio/processing/CustomWaveChannelLayout';
import {createAudioPackages} from './upstream';
import {canonicalAudioCodec} from './packages';
import {outputLayout,downmixPolicy} from './policy';
import {velaTrackConfiguration} from './ffmpeg/track-configuration';

export interface CoreAudioFailure {epoch:number;trackId:string;stage:'native'|'software'|'output';message:string}
export interface CoreAudioOptions {
  libraryBaseURL:string;assetKey?:string;signal?:AbortSignal;forceSoftware?:boolean;nightMode?:boolean;
  onClock:(anchor:AudioClockAnchor)=>void;onFailure:(failure:CoreAudioFailure)=>void;
}
interface Attempt {
  track:AudioTrack;epoch:number;generation:number;abort:AbortController;failure:Error|null;
  worker?:AudioDecodeWorkerAttempt;native?:AudioDecoder;mode:'native'|'software';
  batch:AudioDecodeWorkerPacketBatchBuilder;nativeTail:Promise<void>;pendingBytes:number;
  bufferedUntil:number;floor:number;workletGeneration:number;draining:boolean;firstNativeInputUs:number|null;inputsWithoutPCM:number;waiters:Set<()=>void>;
}
const RATE=48000,MAX_PENDING_BYTES=16*1024*1024,MAX_PACKET_BYTES=1024*1024;
function bounded<T>(promise:PromiseLike<T>,signal:AbortSignal,label:string,timeout=8000):Promise<T>{
  return new Promise((resolve,reject)=>{let settled=false;const clean=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort)};
    const finish=(error:unknown,value?:T)=>{if(settled)return;settled=true;clean();if(error!==null)reject(error);else resolve(value!)};
    const abort=()=>finish(signal.reason??new DOMException('Audio operation aborted','AbortError'));
    const timer=setTimeout(()=>finish(new Error(`${label} exceeded its deadline`)),timeout);signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(value=>finish(null,value),error=>finish(error));if(signal.aborted)abort();
  });
}
/** Core owns media extrapolation/scheduling. This module reports physical output anchors only. */
export class CoreAudioOutput implements AudioOutput {
  private readonly context:AudioContext;private readonly lifetime=new AbortController();
  private readonly registry:ReturnType<typeof createAudioPackages>;private readonly worker:Worker;private readonly client:AudioDecodeWorkerClient;
  private readonly nativeFailures=new WeakSet<AudioTrack>();private state:Attempt|null=null;private serial=0;
  private output:AudioWorkletController|null=null;private bridge:CustomDecodeAudioBridge|null=null;private unsubscribe?:()=>void;
  private playing=false;private volume=1;private muted=false;private rate=1;private disposed=false;private disposal?:Promise<void>;
  constructor(private options:CoreAudioOptions){
    const base=new URL(options.libraryBaseURL,location.href);if(base.origin!==location.origin||base.username||base.password)throw new Error('Audio assets must be same-origin');if(!base.pathname.endsWith('/'))base.pathname+='/';
    this.registry=createAudioPackages(new URL('audio-decoders/',base).href);
    const at=new URL('webgpu-player/CustomAudioDecode.worker.js',base);if(options.assetKey)at.searchParams.set('v',options.assetKey);
    this.context=new AudioContext({sampleRate:RATE,latencyHint:'interactive'});
    // Capture activation before metadata/decoder promises. play() reports a blocked resume later.
    void this.context.resume().catch(()=>{});
    try{this.worker=new Worker(at);this.client=new AudioDecodeWorkerClient(()=>this.worker)}catch(error){void this.context.close().catch(()=>{});throw error}
    this.context.addEventListener('sinkchange',this.sinkChanged);options.signal?.addEventListener('abort',this.sourceAborted,{once:true});
    if(options.signal?.aborted)void this.dispose().catch(()=>{});
  }
  private sourceAborted=()=>{void this.dispose().catch(()=>{})};
  private sinkChanged=()=>{if(this.output&&this.output.configuration.channelCount>this.context.destination.maxChannelCount){this.pause();const state=this.state;if(state)this.fail(state,'output',new Error('Audio device layout changed; reconfigure the selected track'))}};
  private current(state:Attempt){return !this.disposed&&this.state===state&&!state.abort.signal.aborted}
  private wake(state:Attempt){for(const wake of [...state.waiters])wake()}
  private fail(state:Attempt,stage:CoreAudioFailure['stage'],error:unknown){
    if(!this.current(state)||state.failure)return;
    state.failure=error instanceof Error?error:new Error('Audio decoder failed');if(stage==='native')this.nativeFailures.add(state.track);this.wake(state);
    this.options.onFailure({epoch:state.epoch,trackId:state.track.id,stage,message:state.failure.message.replace(/https?:\/\/\S+/g,'[media URL]').slice(0,512)});
  }
  private wait(state:Attempt,predicate:()=>boolean,signal:AbortSignal):Promise<void>{
    return new Promise((resolve,reject)=>{let timer:ReturnType<typeof setTimeout>|undefined;let active=0,last=performance.now();const clean=()=>{if(timer)clearTimeout(timer);state.waiters.delete(check);signal.removeEventListener('abort',check);state.abort.signal.removeEventListener('abort',check)};
      const check=()=>{if(signal.aborted||!this.current(state)){clean();reject(signal.reason??new DOMException('Audio epoch retired','AbortError'))}else if(state.failure){clean();reject(state.failure)}else if(predicate()){clean();resolve()}};
      const deadline=()=>{const now=performance.now();if(this.playing)active+=now-last;last=now;if(active>=8000){clean();const error=new Error('Audio decoder input stalled');this.fail(state,state.mode==='native'?'native':'software',error);reject(error)}else timer=setTimeout(deadline,250)};
      state.waiters.add(check);signal.addEventListener('abort',check,{once:true});state.abort.signal.addEventListener('abort',check,{once:true});timer=setTimeout(deadline,250);check();
    });
  }
  private retire(){
    const state=this.state;if(!state)return;this.state=null;state.abort.abort();this.wake(state);
    try{state.native?.close()}catch{}void state.worker?.close().catch(()=>{});this.bridge?.stop(state.generation);
  }
  async configure(track:AudioTrack,epoch:number,signal:AbortSignal){await this.configureAt(track,epoch,0,signal)}
  private async configureAt(track:AudioTrack,epoch:number,positionUs:number,signal:AbortSignal){
    signal.throwIfAborted();if(this.disposed)throw new Error('Audio output is disposed');
    if(!Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(positionUs)||positionUs<0||!Number.isSafeInteger(track.sampleRate)||track.sampleRate<=0||!Number.isSafeInteger(track.channels)||track.channels<1||track.channels>32)throw new Error('Invalid actual audio format/epoch');
    const codec=canonicalAudioCodec(track.codec);if(codec.startsWith('pcm_')&&track.channels>2&&(!track.channelMask||getQualifiedCustomWaveChannelLayout(track.channelMask)?.channelCount!==track.channels))throw new Error('Raw multichannel PCM positions are unknown');
    this.retire();const state:Attempt={track,epoch,generation:++this.serial,abort:new AbortController(),failure:null,mode:'software',batch:new AudioDecodeWorkerPacketBatchBuilder(),nativeTail:Promise.resolve(),pendingBytes:0,bufferedUntil:positionUs,floor:positionUs,workletGeneration:0,draining:false,firstNativeInputUs:null,inputsWithoutPCM:0,waiters:new Set()};this.state=state;
    const operation=AbortSignal.any([signal,state.abort.signal,this.lifetime.signal]);
    try{
      let native=false;
      if(!this.options.forceSoftware&&!this.nativeFailures.has(track)&&track.config&&typeof AudioDecoder==='function'){
        try{native=!!(await bounded(AudioDecoder.isConfigSupported(track.config),operation,'Audio decoder support')).supported}catch(error){operation.throwIfAborted();native=false}
      }
      const selection=native?null:await bounded(this.registry.load(codec,operation),operation,'Audio package loading');
      if(!native&&!selection)throw new Error(`No installed audio decoder for ${codec}`);
      const layout=outputLayout(this.context.destination.maxChannelCount,track.channels),channels=layout==='7.1'?8:layout==='5.1'?6:2;
      if(!this.output||this.output.configuration.channelCount!==channels){
        this.unsubscribe?.();this.unsubscribe=undefined;const previous=this.output;this.output=null;this.bridge=null;
        if(previous)await bounded(previous.destroy(),operation,'Audio output retirement',1000);
        operation.throwIfAborted();configureCustomAudioDestination(this.context,channels);
        const creation=AudioWorkletController.create(this.context,{channelCount:channels,maxBufferedFrames:RATE*2,maxChunks:128,telemetryIntervalFrames:1024});
        let created:AudioWorkletController;
        try{created=await bounded(creation,operation,'AudioWorklet creation')}catch(error){void creation.then(late=>late.destroy()).catch(()=>{});throw error}
        if(!this.current(state)||operation.aborted){await created.destroy();operation.throwIfAborted();throw new DOMException('Audio epoch retired','AbortError')}
        this.output=created;this.bridge=new CustomDecodeAudioBridge(created);this.unsubscribe=created.onTelemetry(this.anchor);
      }
      operation.throwIfAborted();const output=this.output!,bridge=this.bridge!;
      output.setVolume(this.volume);output.setMuted(this.muted);output.setPlaybackRate(this.rate);
      const configuration={channelCount:channels,sampleRate:RATE,codec,sourceChannelCount:track.channels,sourceSampleRate:track.sampleRate};
      const channelMask=track.channelMask&&getQualifiedCustomWaveChannelLayout(track.channelMask)?.channelCount===track.channels?track.channelMask:null;
      const attachment=bridge.start({audioConfiguration:configuration,callbacks:{onFailure:message=>this.fail(state,'output',new Error(message))},decodeGeneration:state.generation,startTimeMicroseconds:requireMicroseconds(positionUs)});
      state.workletGeneration=attachment.workletGeneration;state.mode=native?'native':'software';
      const downmix=downmixPolicy(this.options.nightMode??false);
      const description=track.config?.description;
      const raw=track.codecPrivate??(description?new Uint8Array(ArrayBuffer.isView(description)?description.buffer.slice(description.byteOffset,description.byteOffset+description.byteLength):description.slice(0)):null);
      const privateData=selection&&[...selection.source.manifest.options.values()].includes('velaConfiguration')?velaTrackConfiguration({audioTrack:null,decoderConfig:raw?{description:raw}:null,packageCodecPrivate:track.waveFormat??null,channelCount:track.channels,sampleRate:track.sampleRate,declaredChannelMask:channelMask},codec):raw;
      state.worker=this.client.openAttempt({generation:state.generation,audioEpoch:1,audioDownmixAlgorithm:downmix.audioDownmixAlgorithm,audioDownmixSettings:downmix.audioDownmixSettings,audioOutput:attachment,channelMask,decoderBackend:native?'pcm':'package',outputLayout:layout,packageCodecPrivate:native?null:privateData,packageDecoder:selection,renderBinaural:false,routeCodec:selection?.codec??codec,sourceSampleRate:track.sampleRate,startTimeMicroseconds:requireMicroseconds(positionUs),timeResolution:1000000},{
        onChange:()=>{this.arm(state);const failure=state.worker?.failure;if(failure)this.fail(state,failure.failureKind==='audio-output-failed'?'output':state.mode==='native'?'native':'software',new Error(failure.message));this.wake(state)},onObjectCount:()=>{},onSourceFormat:()=>{},
        onProgress:progress=>{if(!this.current(state))return;bridge.recordSubmission(progress,state.generation);state.bufferedUntil=Math.max(state.bufferedUntil,progress.mediaTimeMicroseconds+progress.durationMicroseconds);this.arm(state);this.wake(state)}
      });
      if(native){
        const decoder=state.native=new AudioDecoder({output:data=>this.nativeData(state,data),error:error=>this.fail(state,'native',error)});
        decoder.addEventListener('dequeue',()=>this.wake(state));decoder.configure(track.config!);
      }
      if(state.worker.failure)throw new Error(state.worker.failure.message);output.setPlaying(false);this.arm(state);this.anchor(output.getTelemetry());
    }catch(error){if(this.state===state)this.retire();throw error}
  }
  private async send(state:Attempt,batch:AudioDecodeWorkerInputBatch,signal:AbortSignal){
    await this.wait(state,()=>!!state.worker?.takeInputCredit(),signal);signal.throwIfAborted();if(!this.current(state))throw new DOMException('Audio epoch retired','AbortError');state.worker!.sendInput(batch);
  }
  private nativeData(state:Attempt,data:AudioData){
    try{
      if(!this.current(state)||!data.numberOfFrames)return;state.firstNativeInputUs=null;state.inputsWithoutPCM=0;
      const bytes=data.numberOfFrames*data.numberOfChannels*4;if(bytes+state.pendingBytes>MAX_PENDING_BYTES)throw new Error('Native PCM queue exceeded its bound');state.pendingBytes+=bytes;
      const samples:AudioDecodeWorkerPCMSample[]=[];
      for(let offset=0;offset<data.numberOfFrames;offset+=16384){const frames=Math.min(16384,data.numberOfFrames-offset),planes:Float32Array[]=[];
        for(let channel=0;channel<data.numberOfChannels;channel++){const plane=new Float32Array(frames);data.copyTo(plane,{planeIndex:channel,format:'f32-planar',frameOffset:offset,frameCount:frames});planes.push(plane)}
        samples.push({channelCount:data.numberOfChannels,channelData:planes,frameCount:frames,mediaTimeMicroseconds:requireMicroseconds(data.timestamp+Math.round(offset*1000000/data.sampleRate)),sampleRate:data.sampleRate});
      }
      state.nativeTail=state.nativeTail.then(async()=>{for(const sample of samples)await this.send(state,{kind:'pcm',samples:[sample]},state.abort.signal)}).catch(error=>{this.fail(state,'output',error)}).finally(()=>{state.pendingBytes-=bytes;this.wake(state)});
    }catch(error){this.fail(state,'native',error)}finally{data.close()}
  }
  async decode(packet:EncodedPacket,signal:AbortSignal){
    const state=this.state;if(!state||packet.epoch!==state.epoch)return;if(packet.trackId!==state.track.id)throw new Error('Audio packet belongs to another track');
    if(packet.data.length>16*1024*1024||!Number.isSafeInteger(packet.timestampUs)||!Number.isSafeInteger(packet.durationUs)||packet.durationUs<0)throw new Error('Invalid audio packet');
    if(state.failure)throw state.failure;signal.throwIfAborted();
    if(state.native){
      await this.wait(state,()=>state.native!.decodeQueueSize<8&&state.pendingBytes<MAX_PENDING_BYTES/2,signal);
      state.firstNativeInputUs??=packet.timestampUs;state.inputsWithoutPCM++;
      if(packet.timestampUs-state.firstNativeInputUs>2000000||state.inputsWithoutPCM>256){const error=new Error('Native audio decoder produced no PCM within its bound');this.fail(state,'native',error);throw error}
      signal.throwIfAborted();
      try{state.native.decode(new EncodedAudioChunk({type:packet.key?'key':'delta',timestamp:packet.timestampUs,duration:packet.durationUs,data:packet.data}))}catch(error){this.fail(state,'native',error);throw error}
    }else{
      const codec=canonicalAudioCodec(state.track.codec),raw=/^pcm_[sfu](8|16|24|32|64)(?:le|be)?$/.exec(codec);
      const bytesPerFrame=raw?Number(raw[1])/8*state.track.channels:['pcm_alaw','pcm_mulaw'].includes(codec)?state.track.channels:0;
      if(bytesPerFrame&&packet.data.length%bytesPerFrame)throw new Error('PCM packet ends inside a sample frame');
      const chunk=bytesPerFrame?Math.min(8192,Math.floor(MAX_PACKET_BYTES/bytesPerFrame))*bytesPerFrame:packet.data.length;
      if(!bytesPerFrame&&chunk>MAX_PACKET_BYTES)throw new Error('Audio packet exceeds decoder batch bound');
      for(let at=0;at<packet.data.length;at+=chunk){
        const time=packet.timestampUs+(bytesPerFrame?Math.round(at/bytesPerFrame*1000000/state.track.sampleRate):0);
        state.batch.add(packet.data.subarray(at,at+chunk),requireMicroseconds(time));
        if(bytesPerFrame||state.batch.isFull()){const batch=state.batch.take()!;await this.send(state,batch,signal)}
      }
    }
  }
  private arm(state:Attempt){
    if(this.current(state)&&this.playing&&this.output&&!this.output.isPlaying&&
      (state.bufferedUntil-state.floor>=80000||state.draining&&state.worker?.finished&&state.bufferedUntil>state.floor))this.output.setPlaying(true);
  }
  async drain(signal:AbortSignal){
    const state=this.state;if(!state)return;state.draining=true;
    if(state.native)await bounded(state.native.flush(),AbortSignal.any([signal,state.abort.signal]),'Audio decoder drain');
    await this.wait(state,()=>state.pendingBytes===0,signal);
    const batch=state.batch.take();if(batch)await this.send(state,batch,signal);state.worker?.finish();
    await this.wait(state,()=>!!state.worker?.finished,signal);
  }
  async flush(positionUs:number,epoch:number,signal:AbortSignal){const track=this.state?.track;if(track)await this.configureAt(track,epoch,positionUs,signal)}
  async play(){if(this.disposed)return;this.playing=true;await bounded(this.context.resume(),this.lifetime.signal,'AudioContext resume',5000);if(this.state)this.arm(this.state)}
  pause(){this.playing=false;this.output?.setPlaying(false)}
  bufferState():AudioBufferState|null{
    const state=this.state,output=this.output?.getTelemetry(),bridge=this.bridge?.getTelemetry();
    if(!state||!output||!bridge)return null;
    return {epoch:state.epoch,bufferedUntilUs:state.bufferedUntil,queuedFrames:output.queuedFrames,
      consumedFrames:output.consumedFrames,outputCredits:this.bridge!.initialAudioSampleCredits,
      pendingChunks:bridge.pendingSampleCount,submittedChunks:bridge.submittedSampleCount};
  }
  setVolume(volume:number,muted:boolean){if(!Number.isFinite(volume)||volume<0||volume>1)throw new Error('Invalid audio volume');this.volume=volume;this.muted=muted;this.output?.setVolume(volume);this.output?.setMuted(muted)}
  setRate(rate:number){if(!Number.isFinite(rate)||rate<0.25||rate>4)throw new Error('Audio playback rate must be between0.25 and4');this.rate=rate;this.output?.setPlaybackRate(rate)}
  private anchor=(telemetry:AudioWorkletTelemetry|null)=>{
    const state=this.state;if(!state||!telemetry||telemetry.generation!==state.workletGeneration||!this.current(state))return;
    let media:number=telemetry.mediaTimeMicroseconds,at=performance.now();const point=telemetry.mediaTimeContextTimeMicroseconds;let correlated=false;
    try{
      const stamp=this.context.getOutputTimestamp();
      if(point!==null&&Number.isFinite(stamp.contextTime)&&Number.isFinite(stamp.performanceTime)&&stamp.contextTime!>0&&stamp.performanceTime!>0){
        const delta=point-stamp.contextTime!*1000000;media-=Math.max(0,delta)*telemetry.playbackRate;at=stamp.performanceTime!+Math.min(0,delta)/1000;correlated=true;
      }
    }catch{}
    if(!correlated&&point!==null){const latency=(this.context.baseLatency??0)+(this.context.outputLatency??0);media-=Math.max(0,this.context.currentTime*1000000-point+latency*1000000)*telemetry.playbackRate}
    const beforeStart=media<state.floor;this.options.onClock({epoch:state.epoch,mediaTimeUs:Math.max(state.floor,Math.round(media)),performanceTimeMs:at,playing:this.playing&&telemetry.playing&&telemetry.queuedFrames>0&&!beforeStart,bufferedUntilUs:Math.max(state.floor,state.bufferedUntil)});
  };
  dispose():Promise<void>{
    if(this.disposal)return this.disposal;this.disposed=true;this.lifetime.abort();this.options.signal?.removeEventListener('abort',this.sourceAborted);this.context.removeEventListener('sinkchange',this.sinkChanged);
    this.retire();this.worker.terminate();this.unsubscribe?.();this.unsubscribe=undefined;
    const output=this.output;this.output=null;this.bridge=null;
    this.disposal=(async()=>{try{await output?.destroy()}finally{await bounded(this.context.close(),new AbortController().signal,'AudioContext close',1000).catch(()=>{})}})();return this.disposal;
  }
}

/** Construct in the play gesture, before async metadata work, to capture audio activation. */
export function createCoreAudioOutput(options:CoreAudioOptions):AudioOutput{return new CoreAudioOutput(options)}
