import Presenter from '../../../../vendor/webgpu-player/src/presentation/WebGPUPresenter';
import { createSDRColorMetadata,createPQColorMetadata,createHLGColorMetadata, type ColorPrimaries, type YUVMatrix } from '../../../../vendor/webgpu-player/src/color/ColorMetadata';
import { createDefaultRenderSettings,createHDRToSDRRenderSettings } from '../../../../vendor/webgpu-player/src/presentation/RenderSettings';
import { createGPUVideoDecodeSessionFactory } from '../../../../vendor/webgpu-player/src/presentation/PresentationSetup';
import { secondsToMicroseconds } from '../../../../vendor/webgpu-player/src/MediaTime';
import { abortable } from '../async';
import type { CoreVideoFrame,VideoPresentation,VideoRoute } from '../decode/video';
import type { CorePresenter } from '../runtime';
import type { VideoTrack } from '../types';

/** Upstream colour/frame presentation as a component; Vela owns its scheduling. */
export class CoreVideoPresenter implements CorePresenter,VideoPresentation {
  private readonly presenter: Presenter;
  private epoch=0;
  constructor(private readonly surface:{container:HTMLDivElement;video:HTMLVideoElement},onFailure:(error:Error)=>void){
    this.presenter=new Presenter((_epoch,reason,detail)=>onFailure(new Error(`Video presentation: ${reason}${detail?` (${detail})`:''}`)),()=>{},()=>onFailure(new Error('WebGPU device lost')));
  }
  createGPUDecodeFactory(){return createGPUVideoDecodeSessionFactory(this.presenter,{slicing:true});}
  async prepare(track:VideoTrack,epoch:number,signal:AbortSignal,route:VideoRoute={kind:'native'}):Promise<void>{
    const transfer=String(track.color.transfer??'');
    const hdr=transfer==='pq'||transfer==='hlg'||transfer==='smpte2084'||transfer==='arib-std-b67';
    if(route.kind==='native'&&hdr)
      throw new Error('Native HDR needs the core HDR/package presentation route');
    if(track.rotation!==0||track.fieldOrder&&track.fieldOrder!=='progressive')
      throw new Error('This actual scan/rotation needs an additional presentation route');
    const primaries=track.color.primaries,matrix=track.color.matrix;
    if(!primaries||!matrix||!['bt709','bt2020','bt470bg','smpte170m'].includes(primaries)||!['bt709','bt2020-ncl','bt470bg','smpte170m'].includes(matrix))
      throw new Error('Actual video colour needs a qualified presentation route');
    if(this.epoch===0)this.presenter.startSession(epoch);else this.presenter.seek(epoch);
    this.epoch=epoch;this.presenter.setDecodedFramePushMode(true,epoch);this.presenter.attach(this.surface,epoch);
    const bytes=track.config?.description;
    const privateBytes=bytes?ArrayBuffer.isView(bytes)?new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength):new Uint8Array(bytes):null;
    const bitDepth=track.codec==='hevc'&&privateBytes&&privateBytes.length>=23&&privateBytes[0]===1?8+(privateBytes[17]&7):8;
    const facts={primaries:primaries as ColorPrimaries,matrix:matrix as YUVMatrix,bitDepth,range:track.color.fullRange?'full' as const:'limited' as const};
    const metadata=transfer==='pq'||transfer==='smpte2084'?createPQColorMetadata(facts):transfer==='hlg'||transfer==='arib-std-b67'?createHLGColorMetadata(facts):createSDRColorMetadata(facts);
    const settings=hdr?createHDRToSDRRenderSettings({toneMapping:{inputPeakNits:metadata.nominalPeakNits}}):createDefaultRenderSettings();
    const configured=await abortable(this.presenter.configureColorPipeline(route.kind==='gpu'
      ?{inputMode:'frame-pool',format:route.format,metadata,settings,automaticInputPeakNits:true}
      :{metadata,settings:createDefaultRenderSettings()},epoch),signal);
    signal.throwIfAborted();
    if(this.epoch!==epoch)throw new DOMException('Presentation superseded','AbortError');
    if(!configured)throw new Error('WebGPU colour pipeline could not be prepared');
    await abortable(this.presenter.prepareDecodedVideo({chromaFormat:null,frameWidth:track.width,frameHeight:track.height},epoch),signal);
  }
  present(frame:CoreVideoFrame,positionUs:number):boolean{
    if(frame.kind==='gpu')return this.presenter.presentDecodedFrame(frame.frame,frame.epoch,undefined,secondsToMicroseconds(positionUs/1e6));
    return this.presenter.presentDecodedFrame({outputMode:'video-frame',frame:frame.frame,
      mediaTimeMicroseconds:secondsToMicroseconds(frame.timestampUs/1e6),durationMicroseconds:secondsToMicroseconds(frame.durationUs/1e6)},
      frame.epoch,undefined,secondsToMicroseconds(positionUs/1e6));
  }
  dispose(){this.presenter.destroy();}
}
