import type {ByteReader} from '../../core/types';
export interface Element {id:number;start:number;data:number;end:number;unknown:boolean}
export interface Box {type:string;start:number;data:number;end:number}
export const integer=(bytes:Uint8Array)=>{let value=0;for(const b of bytes)value=value*256+b;if(!Number.isSafeInteger(value))throw new Error('Subtitle integer exceeds precision');return value};
export const text=(bytes:Uint8Array)=>new TextDecoder().decode(bytes).replace(/\0+$/,'');
export function vint(bytes:Uint8Array,at:number,keepMarker=false):{value:number;length:number;unknown:boolean}{
  const first=bytes[at];if(!first)throw new Error('Invalid subtitle EBML integer');let length=1,mask=128;while(!(first&mask)){length++;mask>>=1}if(length>8||at+length>bytes.length)throw new Error('Truncated subtitle EBML integer');
  let value=keepMarker?first:first&(mask-1),unknown=!keepMarker&&value===mask-1;
  for(let i=1;i<length;i++){value=value*256+bytes[at+i];unknown=unknown&&bytes[at+i]===255}
  if(!unknown&&!Number.isSafeInteger(value))throw new Error('Subtitle EBML integer exceeds precision');return {value,length,unknown};
}
/** Operation bounds, not another byte cache. The core owns all fetched pages. */
export class SubtitleReadScope {
  readonly signal:AbortSignal;private bytes=0;private visits=0;private pages=new Set<number>();
  constructor(readonly reader:ByteReader,readonly size:number,signal:AbortSignal){this.signal=AbortSignal.any([signal,AbortSignal.timeout(8000)])}
  async read(at:number,length:number){
    this.signal.throwIfAborted();if(!Number.isSafeInteger(at)||!Number.isSafeInteger(length)||at<0||length<0||at+length>this.size||length>16*1024*1024)throw new Error('Invalid subtitle metadata range');
    this.bytes+=length;if(this.bytes>48*1024*1024||++this.visits>100000)throw new Error('Subtitle metadata operation exceeds bounds');
    for(let page=Math.floor(at/262144);page<=Math.floor((at+length-1)/262144);page++)this.pages.add(page);
    if(this.pages.size>256)throw new Error('Subtitle acquisition exceeds bounded source coverage');
    const data=await this.reader.read(at,length,this.signal);this.signal.throwIfAborted();if(data.length!==length)throw new Error('Truncated subtitle metadata range');return data;
  }
  async ebml(at:number,limit=this.size):Promise<Element>{
    if(at>=limit)throw new Error('Subtitle EBML element outside parent');const header=await this.read(at,Math.min(12,limit-at));
    const id=vint(header,0,true);if(id.length>4)throw new Error('Invalid subtitle EBML ID');const size=vint(header,id.length),data=at+id.length+size.length,end=size.unknown?limit:data+size.value;
    if(data>limit||!Number.isSafeInteger(end)||end>limit||end<data)throw new Error('Subtitle EBML element exceeds parent');return {id:id.value,start:at,data,end,unknown:size.unknown};
  }
  async children(parent:Element,visit:(element:Element)=>Promise<void>){let at=parent.data;while(at<parent.end){const child=await this.ebml(at,parent.end);await visit(child);if(child.end<=at||child.unknown)throw new Error('Unknown-sized subtitle metadata child');at=child.end}}
  async value(element:Element,max=1024*1024){const size=element.end-element.data;if(size>max)throw new Error('Subtitle metadata field exceeds bound');return this.read(element.data,size)}
  async number(element:Element){return integer(await this.value(element,8))}
  async box(at:number,limit=this.size):Promise<Box>{
    const bytes=await this.read(at,Math.min(16,limit-at));if(bytes.length<8)throw new Error('Truncated subtitle MP4 box');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let size=view.getUint32(0),header=8;
    if(size===1){if(bytes.length<16)throw new Error('Truncated large subtitle MP4 box');size=integer(bytes.subarray(8,16));header=16}else if(size===0)size=limit-at;
    const end=at+size;if(size<header||end>limit||!Number.isSafeInteger(end))throw new Error('Subtitle MP4 box exceeds parent');return {type:String.fromCharCode(...bytes.subarray(4,8)),start:at,data:at+header,end};
  }
  async boxes(parent:Box,visit:(box:Box)=>Promise<void>){for(let at=parent.data;at<parent.end;){const box=await this.box(at,parent.end);await visit(box);at=box.end}}
}
