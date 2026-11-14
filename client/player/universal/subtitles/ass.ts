import {loadAssAssets,type AssAssets,type AssRendererPort} from './assets';
export interface AssOutput {render(time:number):void;resize(width:number,height:number):void;dispose():void}
/** Canvas is owned by this selection. Retiring it prevents stale worker renders reaching a new selection. */
export async function createAssOutput(options:{canvas:HTMLCanvasElement;content:string;fonts:readonly Uint8Array[];assetBaseURL:string;signal:AbortSignal;onFailure:()=>void}):Promise<AssOutput>{
  if(options.content.length>8*1024*1024||options.fonts.reduce((n,font)=>n+font.length,0)>32*1024*1024)throw new Error('ASS document/fonts exceed bounds');
  const signal=AbortSignal.any([options.signal,AbortSignal.timeout(10000)]);let assets:AssAssets|undefined,renderer:AssRendererPort|undefined;
  try{
    assets=await loadAssAssets(options.assetBaseURL,signal);signal.throwIfAborted();
    renderer=new assets.constructor({canvas:options.canvas,subContent:options.content,workerUrl:assets.workerURL,wasmUrl:assets.wasmURL,modernWasmUrl:assets.wasmURL,
      fonts:[assets.font,...options.fonts],availableFonts:{},fallbackFont:'Noto Sans',useLocalFonts:false,onDemandRender:false,offscreenRender:false,asyncRender:true,
      libassMemoryLimit:64,libassGlyphLimit:16,maxRenderHeight:2160});
    const output=renderer;
    // Pinned JASSUB 1.8.8 canvas-only resize falls back to _video.videoWidth when
    // these source dimensions are zero, even with explicit render dimensions.
    const resize=(width:number,height:number)=>{output._videoWidth=width;output._videoHeight=height;output.resize(width,height,0,0)};
    output._videoWidth=options.canvas.width;output._videoHeight=options.canvas.height;
    await new Promise<void>((resolve,reject)=>{
      const clean=()=>{output.removeEventListener('ready',ready);output.removeEventListener('error',error);signal.removeEventListener('abort',abort)};
      const ready=()=>{clean();resolve()},error=()=>{clean();reject(new Error('ASS renderer initialization failed'))},abort=()=>{clean();reject(signal.reason)};
      output.addEventListener('ready',ready,{once:true});output.addEventListener('error',error,{once:true});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    });
    let disposed=false;const failed=()=>{if(!disposed)options.onFailure()};output.addEventListener('error',failed);
    const dispose=()=>{if(disposed)return;disposed=true;options.signal.removeEventListener('abort',dispose);output.removeEventListener('error',failed);output.destroy();assets?.dispose()};
    options.signal.addEventListener('abort',dispose,{once:true});if(options.signal.aborted){dispose();throw options.signal.reason}
    return {render:time=>{if(!disposed&&Number.isFinite(time))output.setCurrentTime(true,time,1)},resize:(width,height)=>{if(!disposed)resize(width,height)},dispose};
  }catch(error){renderer?.destroy();assets?.dispose();throw error}
}
