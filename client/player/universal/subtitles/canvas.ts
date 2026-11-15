import type {PGSDisplay,PGSBitmap} from './pgs';
import type {SubtitlePreferences} from './types';
import type {SubtitleTextCue,SubtitleTextRun,SubtitleTextStyle} from './text';
export interface SubtitleViewport {x:number;y:number;width:number;height:number;bottomInset:number}
const bitmapCanvases=new WeakMap<PGSBitmap,HTMLCanvasElement>();
export function paintPGS(context:CanvasRenderingContext2D,display:PGSDisplay,viewport:SubtitleViewport){
  context.save();context.beginPath();context.rect(viewport.x,viewport.y,viewport.width,viewport.height);context.clip();
  const sx=viewport.width/display.width,sy=viewport.height/display.height;
  for(const bitmap of display.bitmaps){
    let canvas=bitmapCanvases.get(bitmap);if(!canvas){canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const writer=canvas.getContext('2d');if(!writer)throw new Error('Subtitle bitmap canvas unavailable');writer.putImageData(new ImageData(bitmap.rgba.slice(),bitmap.width,bitmap.height),0,0);bitmapCanvases.set(bitmap,canvas)}
    const crop=bitmap.crop??{x:0,y:0,width:bitmap.width,height:bitmap.height};
    context.drawImage(canvas,crop.x,crop.y,crop.width,crop.height,viewport.x+bitmap.x*sx,viewport.y+bitmap.y*sy,crop.width*sx,crop.height*sy);
  }
  context.restore();
}
interface Token {text:string;style:SubtitleTextStyle;width:number}
export function paintText(context:CanvasRenderingContext2D,cues:readonly SubtitleTextCue[],preferences:SubtitlePreferences,viewport:SubtitleViewport){
  const factor={small:0.75,medium:1,large:1.25,xl:1.6}[preferences.subtitleSize];
  const size=Math.max(12,viewport.height*0.058)*factor,lineHeight=size*1.25,padding=size*0.24;
  const font=(style:SubtitleTextStyle)=>`${style.italic?'italic ':''}${style.bold?'bold ':''}${size}px "Noto Sans", sans-serif`;
  const wrap=(runs:readonly SubtitleTextRun[],width:number)=>{
    const lines:Token[][]=[[]];let used=0;
    for(const run of runs)for(const token of run.text.match(/\n|[^\S\n]+|\S+/g)??[]){
      if(token==='\n'){lines.push([]);used=0;continue}
      context.font=font(run.style);const measured=context.measureText(token).width;
      if(used&&used+measured>width){lines.push([]);used=0}
      if(measured<=width){if(!used&&!token.trim())continue;lines.at(-1)!.push({text:token,style:run.style,width:measured});used+=measured}
      else for(const letter of token){const w=context.measureText(letter).width;if(used&&used+w>width){lines.push([]);used=0}lines.at(-1)!.push({text:letter,style:run.style,width:w});used+=w}
      if(lines.length>100)throw new Error('Subtitle layout exceeds line bound');
    }
    return lines;
  };
  context.save();context.beginPath();context.rect(viewport.x,viewport.y,viewport.width,viewport.height);context.clip();context.textBaseline='top';context.textAlign='left';
  let stack=0;const inset=preferences.subtitlePosition==='raised'?Math.max(0,viewport.bottomInset):0;
  for(const cue of cues){
    const maxWidth=viewport.width*Math.min(cue.size??0.9,0.98),lines=wrap(cue.runs,maxWidth);
    const height=lines.length*lineHeight,anchor=viewport.x+(cue.position??(cue.align==='left'?0.05:cue.align==='right'?0.95:0.5))*viewport.width;
    let y=cue.line===undefined?viewport.y+viewport.height*0.94-inset-height-stack:viewport.y+cue.line*viewport.height;
    if(cue.line===undefined)stack+=height+padding;
    for(const line of lines){
      const width=line.reduce((sum,token)=>sum+token.width,0);
      let x=cue.align==='left'?anchor:cue.align==='right'?anchor-width:anchor-width/2;
      x=Math.max(viewport.x+padding,Math.min(viewport.x+viewport.width-width-padding,x));
      if(preferences.subtitleBackground==='box'){context.fillStyle='rgba(0,0,0,0.72)';context.fillRect(x-padding,y-padding,width+padding*2,lineHeight+padding)}
      for(const token of line){
        context.font=font(token.style);context.fillStyle=preferences.subtitleColor==='yellow'?'#ffff00':token.style.color??'#ffffff';
        if(preferences.subtitleBackground==='shadow'){context.strokeStyle='#000';context.lineWidth=Math.max(1,size*0.12);context.lineJoin='round';context.strokeText(token.text,x,y)}
        context.fillText(token.text,x,y);
        if(token.style.underline){context.fillRect(x,y+size*1.05,token.width,Math.max(1,size*0.06))}x+=token.width;
      }
      y+=lineHeight;
    }
  }
  context.restore();
}
