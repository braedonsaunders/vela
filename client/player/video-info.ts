export type DynamicRange='sdr'|'hdr10'|'hlg'|'dv';
export interface VideoInfo {width:number;height:number;codec:string;dynamicRange:DynamicRange|null}
/** Actual decode/probe facts; absence remains unknown rather than guessing HDR. */
export function videoInfo(facts:{width?:number;height?:number;codec?:string;colorTransfer?:string;dvProfile?:number}):VideoInfo|null{
  if(!facts.width||!facts.height||!facts.codec)return null;
  const transfer=facts.colorTransfer;
  const dynamicRange=facts.dvProfile!==undefined?'dv':transfer==='pq'||transfer==='smpte2084'?'hdr10':
    transfer==='hlg'||transfer==='arib-std-b67'?'hlg':transfer&&['bt709','smpte170m','iec61966-2-1','linear','gamma22','gamma28'].includes(transfer)?'sdr':null;
  return{width:facts.width,height:facts.height,codec:facts.codec,dynamicRange};
}
/** Conservative menu recommendation, not a claim about encoder output or a
 * guarantee that variable-bitrate peaks will never exceed this rate. */
export const QUALITY_HEADROOM=1.25;

export function codecFamily(value:string):string{
  const token=value.split('.')[0].toLowerCase();
  return ({avc1:'h264',avc3:'h264',hvc1:'hevc',hev1:'hevc',dvh1:'hevc',dvhe:'hevc',av01:'av1',vp09:'vp9'} as Record<string,string>)[token]??token;
}
