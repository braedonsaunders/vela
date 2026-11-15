import { ALL_FORMATS, CustomSource, Input, InputVideoTrack, PacketReader, type InputTrack, type Source } from 'mediabunny';
import { readWaveFormatAudioTrack } from '../../../../vendor/webgpu-player/src/demux/WaveFormatAudioConfiguration';
import { velaContainerCodec, velaTrackPrivate } from '../../universal/audio/ffmpeg/track-configuration';
import { canonicalAudioCodec } from '../../universal/audio/packages';
import { abortable,delay } from '../async';
import {observeFragmentTiming} from './fragment-time';
import {observeSubtitleClusters,type MatroskaSubtitleStream} from './subtitle-stream';
import {hasBufferAudit,sourceBufferAudit,type BufferCacheState} from '../../universal/buffer-audit';
import {clusterCacheAudit} from './cluster-cache';
import {installMatroskaStreaming,hasStreamingMatroskaBacking,primeMatroskaIndex,finishMatroskaMetadata} from './matroska-stream';
import type { AudioTrack, ByteReader, EncodedPacket, MediaTrack, VideoTrack } from '../types';

/** Demux only. No upstream controller, decoder, clock or independent HTTP cache. */
export class PacketDemux {
  private readonly input: Input;
  private readonly auditSource:Source;
  private readonly lifetime = new AbortController();
  private readonly tracks = new Map<string, InputTrack>();
  private serial: Promise<unknown> = Promise.resolve();
  private operationSignal: AbortSignal;
  private readBytes = 0;
  readonly diagnostics:string[]=[];
  private stopSubtitleClusters?:()=>void;
  private stopStreaming?:()=>void;

  constructor(makeSource:(signal:()=>AbortSignal,count:(bytes:number)=>void)=>Source,
    sourceSignal:AbortSignal,private readonly originUs=0,private readonly liveEnded?:()=>boolean,subtitleClusters?:MatroskaSubtitleStream,private readonly auditCache?:()=>BufferCacheState,streaming?:{reader:ByteReader;startSeconds:number}) {
    this.operationSignal=AbortSignal.any([sourceSignal,this.lifetime.signal]);
    const report=(note:string)=>{if(this.diagnostics.length<16&&!this.diagnostics.includes(note))this.diagnostics.push(note);};
    const source=makeSource(()=>this.operationSignal,bytes=>{
      this.operationSignal.throwIfAborted();this.readBytes+=bytes;
      if(this.readBytes>32*1024*1024)throw new Error('Demux operation exceeded its bounded search budget');
    });
    this.auditSource=source;
    if(streaming)this.stopStreaming=installMatroskaStreaming(source,streaming.reader,AbortSignal.any([sourceSignal,this.lifetime.signal]),streaming.startSeconds,subtitleClusters);
    observeFragmentTiming(source,report);
    if(subtitleClusters)this.stopSubtitleClusters=observeSubtitleClusters(source,subtitleClusters.receive);
    this.input=new Input({source,formats:ALL_FORMATS,formatOptions:{hls:{offsetTimestampsByDateTime:!!liveEnded}}});
    sourceSignal.addEventListener('abort',this.abort,{once:true});
    this.detach = () => sourceSignal.removeEventListener('abort',this.abort);
    if (sourceSignal.aborted) this.dispose();
  }
  private readonly detach: () => void;
  private readonly abort = () => this.dispose();
  get bufferAudit(){return hasBufferAudit(this.auditSource)?sourceBufferAudit(this.auditSource,this.auditCache?.()):null;}
  get clusterCacheAudit(){return clusterCacheAudit(this.auditSource);}

  /** Serial source operations make each cancellation/read budget unambiguous. */
  private operation<T>(run: () => PromiseLike<T> | T, signal: AbortSignal,stage='metadata',parallel=false): Promise<T> {
    if(parallel){
      const operation=AbortSignal.any([signal,this.lifetime.signal,AbortSignal.timeout(8000)]);
      return abortable(Promise.resolve().then(()=>{operation.throwIfAborted();return run();}),operation).catch(error=>{
        if(signal.aborted)throw error;
        throw new Error(`Demux ${stage}: ${error instanceof Error?error.message:'operation failed'}`);
      });
    }
    const work = this.serial.then(async () => {
      signal.throwIfAborted(); this.lifetime.signal.throwIfAborted();
      this.operationSignal = AbortSignal.any([signal,this.lifetime.signal,AbortSignal.timeout(8000)]);
      this.readBytes = 0;
      const abort = () => this.dispose();
      this.operationSignal.addEventListener('abort',abort,{once:true});
      try { return await abortable(run(),this.operationSignal); }
      catch(error){
        if(signal.aborted)throw error;
        const detail=error instanceof Error?`${error.name}: ${error.message}`:'operation failed';
        throw new Error(`Demux ${stage} (${this.readBytes} requested bytes): ${detail}`);
      }
      finally { this.operationSignal.removeEventListener('abort',abort); }
    });
    this.serial = work.catch(() => {});
    return abortable(work,signal);
  }

  async open(signal: AbortSignal,onVideo?:(track:VideoTrack)=>void): Promise<{tracks: MediaTrack[]; durationUs: number | null; container: string}> {
    return this.operation(async () => {
      const [format,videos,audios,duration] = await Promise.all([
        this.input.getFormat(),this.input.getVideoTracks(),this.input.getAudioTracks(),this.liveEnded?Promise.resolve(null):this.input.getDurationFromMetadata(),
      ]);
      const indexing=primeMatroskaIndex(videos[0]??audios[0]);
      void indexing?.catch(()=>{});
      const tracks: MediaTrack[] = [];
      for (const track of videos) {
        const [codec,width,height,rotation,config,color,fieldOrder,language] = await Promise.all([
          track.getCodec(),track.getCodedWidth(),track.getCodedHeight(),track.getRotation(),track.getDecoderConfig(),
          track.getColorSpace(),track.getFieldOrder(),track.getLanguageCode(),
        ]);
        const id = `video:${track.containerTrackId ?? track.id}`;
        const actual: VideoTrack = {id,kind:'video',sourceIndex:null,containerTrackId:track.containerTrackId,
          codec:codec === 'avc' ? 'h264' : codec ?? 'unknown',width,height,rotation,fieldOrder,language,color,
          config:config ? {...config,...(config.description ? {description:copyBytes(config.description)} : {})} : null};
        tracks.push(actual); this.tracks.set(id,track);onVideo?.(actual);
      }
      for (const track of audios) {
        const [codec,internalCodecId,channels,sampleRate,channelMask,config,language] = await Promise.all([
          track.getCodec(),track.getInternalCodecId(),track.getNumberOfChannels(),track.getSampleRate(),
          track.getChannelMask(),track.getDecoderConfig(),track.getLanguageCode(),
        ]);
        const wave = !codec ? readWaveFormatAudioTrack(track) : null;
        const id = `audio:${track.containerTrackId ?? track.id}`;
        const actual: AudioTrack = {id,kind:'audio',sourceIndex:null,containerTrackId:track.containerTrackId,
          codec:codec ? canonicalAudioCodec(codec) : wave?.status === 'read' ? wave.codec : velaContainerCodec(internalCodecId) ?? 'unknown',
          channels,sampleRate,channelMask,language,internalCodecId:internalCodecId instanceof Uint8Array ? internalCodecId.slice() : internalCodecId,
          config:config ? {...config,...(config.description ? {description:copyBytes(config.description)} : {})} : null,
          codecPrivate:velaTrackPrivate(track,config),waveFormat:wave?.status === 'read' ? wave.waveFormat.slice() : null};
        tracks.push(actual); this.tracks.set(id,track);
      }
      await indexing;finishMatroskaMetadata(this.auditSource);
      return {tracks,durationUs:duration === null ? null : Math.round(duration*1e6)+this.originUs,container:format.name};
    },signal);
  }

  async *packets(trackId: string, positionUs: number, epoch: number, signal: AbortSignal): AsyncGenerator<EncodedPacket> {
    const track = this.tracks.get(trackId);
    if (!track) throw new Error('Unknown demux track');
    if (!Number.isFinite(positionUs) || positionUs < 0) throw new Error('Invalid demux seek position');
    const reader = new PacketReader(track);
    const parallel=hasStreamingMatroskaBacking(track);
    const read=<T>(run:()=>PromiseLike<T>|T)=>this.operation(run,signal,track instanceof InputVideoTrack?'video-packet':'audio-packet',parallel);
    const querySeconds=Math.max(0,positionUs-this.originUs)/1e6;
    // Container cues/sample tables locate a preceding random-access packet.
    // Decode audio preroll too; the output stage trims PCM at the exact target.
    // getFirst preserves negative AAC priming at the start instead of skipping it.
    let packet = await read(() => track instanceof InputVideoTrack
      ? reader.getKeyAt(querySeconds,{skipLiveWait:!!this.liveEnded}) : querySeconds===0?reader.getFirst({skipLiveWait:!!this.liveEnded}):reader.getAt(Math.max(0,querySeconds-0.1),{skipLiveWait:!!this.liveEnded}));
    if (!packet) {
      const first = await read(() => track instanceof InputVideoTrack ? reader.getFirstKey() : reader.getFirst());
      // A track starting after the target needs its first packet. EOF must never
      // wrap to packet zero and silently replay the beginning of the title.
      if (first && first.timestamp * 1e6 + this.originUs >= positionUs) packet = first;
    }
    while (packet || this.liveEnded&&!this.liveEnded()) {
      if(!packet){await delay(100,signal);packet=await read(()=>track instanceof InputVideoTrack?reader.getKeyAt(querySeconds,{skipLiveWait:true}):reader.getAt(Math.max(0,querySeconds-0.1),{skipLiveWait:true}));continue;}
      signal.throwIfAborted();
      if (packet.data.length > 16 * 1024 * 1024) throw new Error('Encoded packet exceeds decode budget');
      if (![packet.timestamp,packet.duration].every(Number.isFinite) || packet.duration < 0) throw new Error('Invalid encoded packet timing');
      yield {trackId,epoch,data:packet.data,timestampUs:Math.round(packet.timestamp*1e6)+this.originUs,durationUs:Math.round(packet.duration*1e6),
        key:packet.type === 'key',additions:packet.sideData.matroskaBlockAdditions?.map(item => ({addId:item.addId,data:item.data}))};
      const previous = packet;
      packet = await read(() => reader.getNext(previous,{skipLiveWait:!!this.liveEnded}));
      while(!packet&&this.liveEnded&&!this.liveEnded()){
        await delay(100,signal);packet=await read(()=>reader.getNext(previous,{skipLiveWait:true}));
      }
    }
  }

  dispose(): void { if(this.lifetime.signal.aborted)return;this.lifetime.abort(); this.detach?.();this.stopSubtitleClusters?.();this.stopStreaming?.(); this.input.dispose(); this.tracks.clear(); }
}

/** Original-file transport: the reader and its cache survive demux epochs. */
export class FileDemux extends PacketDemux {
  constructor(readonly reader:ByteReader,signal:AbortSignal,subtitleClusters?:MatroskaSubtitleStream,auditCache?:()=>BufferCacheState,startSeconds=0){
    super((current,count)=>new CustomSource({
      getSize:()=>reader.size(current()),read:(start,end)=>{count(end-start);return reader.read(start,end-start,current());},
      maxCacheSize:0,prefetchProfile:'none',
    }),signal,0,undefined,subtitleClusters,auditCache,{reader,startSeconds});
  }
}

function copyBytes(value: AllowSharedBufferSource): Uint8Array<ArrayBuffer> {
  return ArrayBuffer.isView(value)
    ? new Uint8Array(new Uint8Array(value.buffer,value.byteOffset,value.byteLength)) : new Uint8Array(new Uint8Array(value));
}
