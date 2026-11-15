import Presenter from '../../../../vendor/webgpu-player/src/presentation/WebGPUPresenter';
import { createSDRColorMetadata, type ColorPrimaries, type YUVMatrix } from '../../../../vendor/webgpu-player/src/color/ColorMetadata';
import { createDefaultRenderSettings } from '../../../../vendor/webgpu-player/src/presentation/RenderSettings';
import { secondsToMicroseconds } from '../../../../vendor/webgpu-player/src/MediaTime';
import { abortable } from '../async';
import type { NativeVideoFrame } from '../decode/native-video';
import type { CorePresenter } from '../runtime';
import type { VideoTrack } from '../types';

/** Presentation component only. Initial core route: actual native-decoded SDR. */
export class NativeSDRPresenter implements CorePresenter {
  private readonly presenter: Presenter;
  private epoch=0;
  constructor(private readonly surface:{container:HTMLDivElement;video:HTMLVideoElement},onFailure:(error:Error)=>void){
    this.presenter=new Presenter((_epoch,reason,detail)=>onFailure(new Error(`Video presentation: ${reason}${detail?` (${detail})`:''}`)),()=>{},()=>onFailure(new Error('WebGPU device lost')));
  }
  async prepare(track:VideoTrack,epoch:number,signal:AbortSignal):Promise<void>{
    const transfer=String(track.color.transfer??'');
    if(transfer==='pq'||transfer==='hlg'||String(transfer)==='smpte2084'||String(transfer)==='arib-std-b67')
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
    const configured=await abortable(this.presenter.configureColorPipeline({
      metadata:createSDRColorMetadata({primaries:primaries as ColorPrimaries,matrix:matrix as YUVMatrix,bitDepth,
        range:track.color.fullRange?'full':'limited'}),settings:createDefaultRenderSettings(),
    },epoch),signal);
    signal.throwIfAborted();
    if(this.epoch!==epoch)throw new DOMException('Presentation superseded','AbortError');
    if(!configured)throw new Error('WebGPU SDR colour pipeline could not be prepared');
    await abortable(this.presenter.prepareDecodedVideo({chromaFormat:null,frameWidth:track.width,frameHeight:track.height},epoch),signal);
  }
  present(frame:NativeVideoFrame,positionUs:number):boolean{
    return this.presenter.presentDecodedFrame({outputMode:'video-frame',frame:frame.frame,
      mediaTimeMicroseconds:secondsToMicroseconds(frame.timestampUs/1e6),durationMicroseconds:secondsToMicroseconds(frame.durationUs/1e6)},
      frame.epoch,undefined,secondsToMicroseconds(positionUs/1e6));
  }
  dispose(){this.presenter.destroy();}
}
