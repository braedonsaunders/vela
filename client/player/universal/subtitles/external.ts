export class SubtitleHTTPError extends Error {constructor(readonly status:number){super(`Subtitle document HTTP ${status}`)}}
export async function readSubtitleDocument(url:string,signal:AbortSignal,max=8*1024*1024):Promise<Uint8Array>{
  const parsed=new URL(url,location.href);if(!['https:','http:'].includes(parsed.protocol)||parsed.origin!==location.origin||parsed.username||parsed.password)throw new Error('Subtitle URL is not same-origin');
  const response=await fetch(parsed,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),credentials:'same-origin',redirect:'error'});if(!response.ok)throw new SubtitleHTTPError(response.status);
  const reader=response.body?.getReader();if(!reader)throw new Error('Subtitle response has no body');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const next=await reader.read();if(next.done)break;signal.throwIfAborted();size+=next.value.length;if(size>max)throw new Error('Subtitle document exceeds size bound');chunks.push(next.value)}}finally{await reader.cancel().catch(()=>{})}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}return bytes;
}
