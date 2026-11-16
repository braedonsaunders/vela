export interface DeliverySample {
  requests:number;
  bytes:number;
  goodputBps:number|null;
  maxTtfbMs:number;
  windowMs:number;
  capWaitMs:number|null;
}
export interface DeliveryOptions {
  intervalStart?:number;
  kind?:'media'|'metadata'|'speculative';
  capWaitMs?:number|null;
}

/** Only an explicit finite response hint can establish an unqueued request.
 * Missing/malformed hints stay unknown, never silently become zero. */
export function mediaCapWait(response:Response):number|null{
  const raw=response.headers.get('X-Ether-Media-Cap-Wait-Ms');
  if(raw===null||raw.trim()==='')return null;
  const value=Number(raw);return Number.isFinite(value)&&value>=0?value:null;
}

/** Scalar publication history; no URLs, headers or content. Window goodput
 * includes idle time and TTFB, and can sample a range opened before the mark. */
export class DeliveryMeter {
  private samples:{start:number;end:number;bytes:number;ttfb:number;capWait:number|null;kind:string}[]=[];
  mark(){return performance.now();}
  record(start:number,firstByte:number,bytes:number,options:DeliveryOptions={}){
    const end=performance.now(),interval=options.intervalStart??start;
    if(![start,firstByte,interval,bytes,end].every(Number.isFinite)||bytes<=0||firstByte<start||end<firstByte||interval>end)return;
    this.samples.push({start:interval,end,bytes,ttfb:firstByte-start,capWait:options.capWaitMs??null,kind:options.kind??'media'});
    if(this.samples.length>512)this.samples.shift();
  }
  since(mark:number):DeliverySample{
    const end=performance.now(),windowMs=Math.max(0,end-mark);
    const rows=this.samples.filter(row=>row.kind==='media'&&row.end>mark);
    let bytes=0,maxTtfbMs=0,capWaitMs:number|null=rows.length?0:null;
    for(const row of rows){
      const span=row.end-row.start,fraction=span>0?Math.min(1,Math.max(0,row.end-mark)/span):1;
      bytes+=row.bytes*fraction;maxTtfbMs=Math.max(maxTtfbMs,row.ttfb);
      if(row.capWait===null)capWaitMs=null;else if(capWaitMs!==null)capWaitMs=Math.max(capWaitMs,row.capWait);
    }
    return{requests:rows.length,bytes,goodputBps:windowMs>0&&rows.length?bytes*8000/windowMs:null,maxTtfbMs,windowMs,capWaitMs};
  }
}
