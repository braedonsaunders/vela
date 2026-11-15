import manifest from './assets.json';
export const subtitleAssetKey=manifest.assetKey;
export interface AssRendererPort extends EventTarget {createEvent(event:Record<string,unknown>):void;getStyles(callback:(error:Error|null,styles:{Name:string}[])=>void):void;_videoWidth:number;_videoHeight:number;resize(width:number,height:number,top?:number,left?:number):void;setCurrentTime(paused:boolean,time:number,rate:number):void;destroy():void}
export interface AssConstructor {new(options:Record<string,unknown>):AssRendererPort}
export interface AssAssets {constructor:AssConstructor;workerURL:string;wasmURL:string;font:Uint8Array;dispose():void}
/** Verify every executable/font before use. Blob URLs keep verified bytes attached to this owner. */
export async function loadAssAssets(baseURL:string,signal:AbortSignal):Promise<AssAssets>{
  const base=new URL(baseURL,location.href);
  if(base.origin!==location.origin||base.username||base.password||base.search||base.hash)throw new Error('Invalid subtitle asset base');
  if(!base.pathname.endsWith('/'))base.pathname+='/';
  const read=async(name:'jassub.js'|'jassub-worker.js'|'jassub-worker.wasm'|'NotoSans.ttf')=>{
    const expected=manifest.files[name];const response=await fetch(new URL(name,base),{signal,credentials:'same-origin',redirect:'error'});
    if(!response.ok||Number(response.headers.get('Content-Length'))>expected.bytes)throw new Error('Subtitle asset unavailable');
    const reader=response.body?.getReader();if(!reader)throw new Error('Subtitle asset has no body');
    const bytes=new Uint8Array(expected.bytes);let at=0;
    try{for(;;){const next=await reader.read();if(next.done)break;signal.throwIfAborted();if(at+next.value.length>bytes.length)throw new Error('Subtitle asset exceeds size bound');bytes.set(next.value,at);at+=next.value.length}}finally{await reader.cancel().catch(()=>{})}
    if(at!==bytes.length)throw new Error('Truncated subtitle asset');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
    signal.throwIfAborted();if(hash!==expected.sha256)throw new Error('Subtitle asset integrity mismatch');return bytes;
  };
  const [module,worker,wasm,font]=await Promise.all([read('jassub.js'),read('jassub-worker.js'),read('jassub-worker.wasm'),read('NotoSans.ttf')]);
  const urls:string[]=[];const blob=(bytes:Uint8Array,type:string)=>{const url=URL.createObjectURL(new Blob([bytes.slice().buffer],{type}));urls.push(url);return url};
  try{
    const moduleURL=blob(module,'application/javascript'),workerURL=blob(worker,'application/javascript'),wasmURL=blob(wasm,'application/wasm');
    const loaded=await import(/* @vite-ignore */ moduleURL) as {default:AssConstructor};signal.throwIfAborted();
    if(typeof loaded.default!=='function')throw new Error('Invalid ASS renderer module');
    return {constructor:loaded.default,workerURL,wasmURL,font,dispose:()=>{for(const url of urls)URL.revokeObjectURL(url)}};
  }catch(error){for(const url of urls)URL.revokeObjectURL(url);throw error}
}
