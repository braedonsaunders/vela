export interface SubtitleTextStyle {bold?:boolean;italic?:boolean;underline?:boolean;color?:string}
export interface SubtitleTextRun {text:string;style:SubtitleTextStyle}
export interface SubtitleTextCue {start:number;end:number;runs:SubtitleTextRun[];align:'left'|'center'|'right';line?:number;position?:number;size?:number}
function timestamp(value:string):number|null{
  const match=/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value.trim());if(!match||+match[2]>59||+match[3]>59)return null;
  return (+(match[1]??0)*3600)+(+match[2]*60)+(+match[3])+(+match[4]/1000);
}
function entity(value:string):string{return value.replace(/&(?:amp|lt|gt|nbsp|lrm|rlm|quot|apos|#\d+|#x[\da-f]+);/gi,token=>{
  const names:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&nbsp;':'\u00a0','&lrm;':'\u200e','&rlm;':'\u200f','&quot;':'"','&apos;':"'"};
  if(names[token.toLowerCase()]!==undefined)return names[token.toLowerCase()];const code=parseInt(token.slice(token[2]?.toLowerCase()==='x'?3:2,-1),token[2]?.toLowerCase()==='x'?16:10);
  return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'\ufffd';
})}
/** Whitelisted inline text styling, never DOM/HTML injection or remote resources. */
export function parseSubtitleRuns(text:string):SubtitleTextRun[]{
  const runs:SubtitleTextRun[]=[];const stack:{tag:string;style:SubtitleTextStyle}[]=[{tag:'',style:{}}];
  for(const token of text.split(/(<[^>]*>)/g)){
    if(!token)continue;
    if(token[0]!=='<'){runs.push({text:entity(token),style:{...stack.at(-1)!.style}});continue}
    if(/^<br\s*\/?\s*>$/i.test(token)){runs.push({text:'\n',style:{...stack.at(-1)!.style}});continue}
    const closing=/^<\/(b|i|u|font|c)>$/i.exec(token);if(closing){const index=stack.map(s=>s.tag).lastIndexOf(closing[1].toLowerCase());if(index>0)stack.splice(index);continue}
    const opening=/^<(b|i|u|font|c)(?:\s[^>]*|\.[\w.-]+)?>$/i.exec(token);if(!opening||stack.length>=32)continue;
    const tag=opening[1].toLowerCase(),style={...stack.at(-1)!.style};
    if(tag==='b')style.bold=true;if(tag==='i')style.italic=true;if(tag==='u')style.underline=true;
    const color=/\bcolor\s*=\s*["']?([#\w]+)["']?/i.exec(token)?.[1]??(/^<c\.([\w]+)>$/i.exec(token)?.[1]);
    if(color&&(/^[#][\da-f]{3}(?:[\da-f]{3})?$/i.test(color)||/^(white|yellow|lime|cyan|red|magenta|blue|black)$/i.test(color)))style.color=color;
    stack.push({tag,style});
  }
  return runs;
}
export function parseTextSubtitles(document:string,codec:'srt'|'webvtt'):SubtitleTextCue[]{
  document=document.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n');
  if(codec==='webvtt'&&!/^WEBVTT(?:\s|$)/.test(document))throw new Error('Invalid WebVTT header');
  const cues:SubtitleTextCue[]=[];
  for(const block of document.split(/\n[\t ]*\n+/)){
    const lines=block.split('\n');if(/^(WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0]))continue;
    const timingIndex=lines.findIndex(line=>line.includes('-->'));if(timingIndex<0)continue;
    const timing=/^(\S+)\s+-->\s+(\S+)(.*)$/.exec(lines[timingIndex]);if(!timing)throw new Error('Invalid subtitle cue timing');
    const start=timestamp(timing[1]),end=timestamp(timing[2]);if(start===null||end===null||end<start)throw new Error('Invalid subtitle cue interval');
    const text=lines.slice(timingIndex+1).join('\n');if(text.length>32768||cues.length>=100000)throw new Error('Subtitle cue exceeds size bound');
    const cue:SubtitleTextCue={start,end,runs:parseSubtitleRuns(text),align:'center'};
    const align=/\balign:(start|left|center|middle|end|right)\b/.exec(timing[3])?.[1];if(align)cue.align=align==='start'||align==='left'?'left':align==='end'||align==='right'?'right':'center';
    for(const field of ['line','position','size'] as const){const value=new RegExp('\\b'+field+':(\\d+(?:\\.\\d+)?)%').exec(timing[3]);if(value&&+value[1]<=100)cue[field]=+value[1]/100}
    cues.push(cue);
  }
  return cues.sort((a,b)=>a.start-b.start||a.end-b.end);
}
/** Prefix maxima preserve long overlapping cues while bounding the active display. */
export class SubtitleCueIndex {
  private ends:number[]=[];
  constructor(readonly cues:readonly SubtitleTextCue[]){let end=-Infinity;this.ends=cues.map(cue=>end=Math.max(end,cue.end))}
  active(time:number):SubtitleTextCue[]{
    let low=0,high=this.ends.length;while(low<high){const mid=(low+high)>>>1;if(this.ends[mid]<=time)low=mid+1;else high=mid}
    const active:SubtitleTextCue[]=[];for(let i=low;i<this.cues.length&&this.cues[i].start<=time;i++)if(this.cues[i].end>time){active.push(this.cues[i]);if(active.length===64)break}return active;
  }
}
