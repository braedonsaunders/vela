import {parseSubtitleRuns,type SubtitleTextCue,type SubtitleTextStyle} from './text';
import type {SubtitlePacket} from './types';
export interface AssEventInput {Start:number;Duration:number;Style:string;Name:string;MarginL:number;MarginR:number;MarginV:number;Effect:string;Text:string;ReadOrder:number;Layer:number}
export function decodeSubtitleText(bytes:Uint8Array):string{
  const encoding=bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':'utf-8';
  try{return new TextDecoder(encoding,{fatal:true}).decode(bytes)}catch{throw new Error('Subtitle text encoding requires server conversion')}
}
function interval(packet:SubtitlePacket){if(packet.duration===null||!Number.isFinite(packet.duration)||packet.duration<0)throw new Error('Subtitle cue duration is unavailable');return {start:packet.time,end:packet.time+packet.duration}}
export function utf8Cue(packet:SubtitlePacket):SubtitleTextCue{return {...interval(packet),runs:parseSubtitleRuns(decodeSubtitleText(packet.data)),align:'center'}}
/** Matroska ASS blocks omit start/end; preserve their exact millisecond times in the renderer API. */
export function assEvent(packet:SubtitlePacket):AssEventInput{
  interval(packet);const text=decodeSubtitleText(packet.data);const values:string[]=[];let at=0;
  for(let field=0;field<8;field++){const comma=text.indexOf(',',at);if(comma<0)throw new Error('Truncated Matroska ASS event');values.push(text.slice(at,comma));at=comma+1}values.push(text.slice(at));
  const number=(value:string)=>{const n=Number(value||0);if(!Number.isSafeInteger(n)||Math.abs(n)>0x7fffffff)throw new Error('Invalid ASS numeric field');return n};
  return {Start:Math.round(packet.time*1000),Duration:Math.round(packet.duration!*1000),ReadOrder:number(values[0]),Layer:number(values[1]),Style:values[2],Name:values[3],MarginL:number(values[4]),MarginR:number(values[5]),MarginV:number(values[6]),Effect:values[7],Text:values[8]};
}
function boxes(bytes:Uint8Array,at:number,end:number,visit:(type:string,payload:Uint8Array)=>void){
  while(at<end){if(at+8>end)throw new Error('Truncated subtitle cue box');const size=new DataView(bytes.buffer,bytes.byteOffset+at,4).getUint32(0);if(size<8||at+size>end)throw new Error('Invalid subtitle cue box');visit(String.fromCharCode(...bytes.subarray(at+4,at+8)),bytes.subarray(at+8,at+size));at+=size}
}
export function wvttCues(packet:SubtitlePacket):SubtitleTextCue[]{
  const cues:SubtitleTextCue[]=[];
  boxes(packet.data,0,packet.data.length,(type,payload)=>{if(type==='vtte')return;if(type!=='vttc')return;let text='',settings='';
    boxes(payload,0,payload.length,(kind,value)=>{if(kind==='payl')text=decodeSubtitleText(value);if(kind==='sttg')settings=decodeSubtitleText(value)});
    const cue:SubtitleTextCue={...interval(packet),runs:parseSubtitleRuns(text),align:'center'};
    const align=/\balign:(start|left|center|end|right)\b/.exec(settings)?.[1];if(align)cue.align=align==='left'||align==='start'?'left':align==='right'||align==='end'?'right':'center';
    for(const field of ['line','position','size'] as const){const value=new RegExp('\\b'+field+':(\\d+(?:\\.\\d+)?)%').exec(settings);if(value&&+value[1]<=100)cue[field]=+value[1]/100}cues.push(cue);
  });
  return cues;
}
function style(record:Uint8Array):SubtitleTextStyle{
  if(record.length<12)throw new Error('Truncated tx3g style');const flags=record[6];
  return {bold:!!(flags&1),italic:!!(flags&2),underline:!!(flags&4),color:`rgba(${record[8]},${record[9]},${record[10]},${record[11]/255})`};
}
export function tx3gCue(packet:SubtitlePacket,configuration:Uint8Array|null):SubtitleTextCue|null{
  if(packet.data.length<2)throw new Error('Truncated tx3g sample');const length=packet.data[0]*256+packet.data[1];if(length+2>packet.data.length)throw new Error('Truncated tx3g text');if(!length)return null;
  const value=decodeSubtitleText(packet.data.subarray(2,2+length)),chars=Array.from(value),base=configuration&&configuration.length>=46?style(configuration.subarray(34,46)):{};
  const ranges:{start:number;end:number;style:SubtitleTextStyle}[]=[];
  boxes(packet.data,2+length,packet.data.length,(type,payload)=>{if(type!=='styl')return;if(payload.length<2)throw new Error('Truncated tx3g style list');const count=payload[0]*256+payload[1];if(count>4096||2+count*12>payload.length)throw new Error('Invalid tx3g style list');for(let i=0;i<count;i++){const record=payload.subarray(2+i*12,14+i*12),start=record[0]*256+record[1],end=record[2]*256+record[3];if(end<start)throw new Error('Invalid tx3g style range');ranges.push({start:Math.min(start,chars.length),end:Math.min(end,chars.length),style:style(record)})}});
  const edges=[...new Set([0,chars.length,...ranges.flatMap(range=>[range.start,range.end])])].sort((a,b)=>a-b);
  const runs=[];for(let i=1;i<edges.length;i++){const start=edges[i-1],end=edges[i];let active={...base};for(const range of ranges)if(range.start<=start&&range.end>=end)active={...active,...range.style};runs.push({text:chars.slice(start,end).join(''),style:active})}
  return {...interval(packet),runs,align:'center'};
}
