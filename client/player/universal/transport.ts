import { BandwidthEstimator } from '../abr';
export interface TransferSample {bytes:number;milliseconds:number;cached:boolean}
export interface NetworkReadout {throughputBps:number|null;history:number[]}
const decoders=new WeakMap<object,{generation:number;bandwidth:BandwidthEstimator}>();
/** Called only after the library has rejected stale worker generations. */
export function recordDecoderTransfer(owner:object,generation:number,sample:TransferSample){
  if(!Number.isSafeInteger(generation)||generation<1||!Number.isSafeInteger(sample?.bytes)||sample.bytes<0||
    sample.bytes>512*1024*1024||!Number.isFinite(sample.milliseconds)||sample.milliseconds<=0||typeof sample.cached!=='boolean')return;
  let state=decoders.get(owner);
  if(!state||state.generation!==generation){state={generation,bandwidth:new BandwidthEstimator()};decoders.set(owner,state);}
  state.bandwidth.sample(sample.bytes,sample.milliseconds,sample.cached);
}
export function decoderNetwork(owner:object,generation:number|null):NetworkReadout{
  const state=decoders.get(owner);
  return state&&state.generation===generation?{throughputBps:state.bandwidth.bps,history:state.bandwidth.history}: {throughputBps:null,history:[]};
}
/** Browser network timing excludes decoder-driven consumption/backpressure.
 * Never clone or intercept private media bytes; unsupported timing stays unknown. */
export function measureDecodeResponse(response:Response,started:number,publish:(sample:TransferSample)=>void):Response{
  if(typeof PerformanceObserver!=='function'||!response.url)return response;
  const headersAt=performance.now();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const observer=new PerformanceObserver(list=>{
    const entries=(list.getEntries() as PerformanceResourceTiming[]).filter(entry=>entry.name===response.url&&
      entry.initiatorType==='fetch'&&entry.startTime>=started-1&&entry.startTime<=headersAt&&entry.responseEnd>=entry.responseStart)
      .sort((a,b)=>Math.abs(a.startTime-started)-Math.abs(b.startTime-started));
    const entry=entries[0];if(!entry)return;
    observer.disconnect();if(timer)clearTimeout(timer);
    const milliseconds=entry.responseEnd-entry.requestStart;
    const bytes=entry.encodedBodySize;
    const cached=entry.transferSize===0||Number(response.headers.get('Age')??0)>0||/hit/i.test(response.headers.get('X-Cache')??'');
    if(bytes>=16384&&milliseconds>=50)publish({bytes,milliseconds,cached});
  });
  try{observer.observe({type:'resource',buffered:true});timer=setTimeout(()=>observer.disconnect(),30000);}catch{observer.disconnect();}
  return response;
}
