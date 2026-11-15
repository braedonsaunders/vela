export class SubtitleHTTPError extends Error {constructor(readonly status:number){super(`Subtitle document HTTP ${status}`)}}
export interface SubtitleDocumentResponse {bytes:Uint8Array;complete:boolean|null}
/** Completeness is authoritative only on HTTP200; older servers remain unknown. */
export async function readSubtitleDocumentResponse(url:string,signal:AbortSignal,max=8*1024*1024,policy?:import('../../media-auth').MediaRequestPolicy):Promise<SubtitleDocumentResponse>{
  const parsed=new URL(url,location.href);if(!['https:','http:'].includes(parsed.protocol)||(policy?!policy.allows(parsed):parsed.origin!==location.origin)||parsed.username||parsed.password)throw new Error('Subtitle URL is outside its authorization');
  const response=await (policy?.fetch??fetch)(parsed,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),credentials:'same-origin',redirect:'error'});if(!response.ok)throw new SubtitleHTTPError(response.status);
  const reader=response.body?.getReader();if(!reader)throw new Error('Subtitle response has no body');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const next=await reader.read();if(next.done)break;signal.throwIfAborted();size+=next.value.length;if(size>max)throw new Error('Subtitle document exceeds size bound');chunks.push(next.value)}}finally{await reader.cancel().catch(()=>{})}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}
  const marker=response.status===200?response.headers.get('X-Ether-Subtitle-Complete'):null;
  return {bytes,complete:marker==='1'?true:marker==='0'?false:null};
}

/** Byte-only compatibility API for static documents and fonts. */
export async function readSubtitleDocument(url:string,signal:AbortSignal,max=8*1024*1024,policy?:import('../../media-auth').MediaRequestPolicy):Promise<Uint8Array>{return (await readSubtitleDocumentResponse(url,signal,max,policy)).bytes}
