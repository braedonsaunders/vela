/** A narrow repair for muxers that wrote AAC encoder preroll as unsigned tfdt.
 * Read the two exact words BEFORE conversion to Number: the rounded 64-bit
 * value has already lost the small priming offset and cannot be subtracted. */
const observers=new WeakMap<object,(note:string)=>void>();
export function observeFragmentTiming(source:object,report:(note:string)=>void){observers.set(source,report);}
export function inheritFragmentTiming(parent:object,child:object){const report=observers.get(parent);if(report)observers.set(child,report);}
/** Keep the failing HLS child identity when a library format probe rejects.
 * An index is safe diagnostic context; the authorized URL and bytes stay local. */
export function contextualizeHlsInput<T>(input:{_rootSource:object;_getDemuxer():T|PromiseLike<T>},index:number){
  const getDemuxer=input._getDemuxer.bind(input);
  input._getDemuxer=async()=>{
    try{return await getDemuxer();}
    catch(error){
      if(error instanceof Error&&error.name==='UnsupportedInputFormatError'){
        const scope=index<0?'init':`fragment ${index}`;
        observers.get(input._rootSource)?.(`hls-format:${scope}:unrecognized`);
        throw new Error(`HLS ${scope}: ${error.message}`,{cause:error});
      }
      throw error;
    }
  };
}
interface FragmentTrack {timescale:number;info:{type:string;codec?:string|null;sampleRate?:number}|null}
export function fragmentDecodeTime(source:object,track:FragmentTrack|null,high:number,low:number):number{
  const normal=high*0x100000000+low;
  const report=observers.get(source),info=track?.info,rate=track?.timescale;
  if(!report||high!==0xffffffff||info?.type!=='audio'||info.codec!=='aac'||
    typeof rate!=='number'||!Number.isSafeInteger(rate)||rate<8000||rate>384000||info.sampleRate!==rate)return normal;
  const raw=(BigInt(high)<<32n)|BigInt(low),signed=BigInt.asIntN(64,raw);
  // At most 8192 AAC priming samples and 250 ms. Everything else remains an
  // invalid timestamp, not an invented clock reset or a blanket signed cast.
  const limit=BigInt(Math.min(8192,Math.floor(rate/4)));
  if(signed>=0n||signed < -limit)return normal;
  const samples=Number(signed);
  report(`audio-timing:aac-priming-wrap:${samples}/${rate}`);
  return samples;
}
