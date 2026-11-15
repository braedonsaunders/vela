export interface DeliverySample {
  requests:number;
  bytes:number;
  goodputBps:number|null;
  maxTtfbMs:number;
}

/** Scalar acquisition history only. Parallel requests share wall time; cached
 * reader hits need no entry. No URL, header or media content is retained. */
export class DeliveryMeter {
  private samples:{start:number;end:number;bytes:number;ttfb:number}[]=[];
  mark(){return performance.now();}
  record(start:number,firstByte:number,bytes:number){
    const end=performance.now();
    if(![start,firstByte,bytes,end].every(Number.isFinite)||bytes<=0||firstByte<start||end<firstByte)return;
    this.samples.push({start,end,bytes,ttfb:firstByte-start});
    if(this.samples.length>256)this.samples.shift();
  }
  since(mark:number):DeliverySample{
    const rows=this.samples.filter(row=>row.start>=mark).sort((a,b)=>a.start-b.start);
    let bytes=0,active=0,end=-Infinity,maxTtfbMs=0;
    for(const row of rows){bytes+=row.bytes;maxTtfbMs=Math.max(maxTtfbMs,row.ttfb);active+=Math.max(0,row.end-Math.max(row.start,end));end=Math.max(end,row.end);}
    return{requests:rows.length,bytes,goodputBps:active>0?bytes*8000/active:null,maxTtfbMs};
  }
}
