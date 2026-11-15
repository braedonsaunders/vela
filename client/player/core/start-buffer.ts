import type {DeliverySample} from './source/delivery';

export interface StartBufferResult {
  reason:'healthy'|'latency'|'headroom'|'latency-and-headroom';
  heldMilliseconds:number;
  targetSeconds:number;
  bufferedSeconds:number;
  headroom:number|null;
  maxTtfbMilliseconds:number;
  capped:boolean;
}

/** A cold acquisition ramp changes the startup reserve, never the output queue
 * bound or the media clock. Warm in-memory seeks keep the normal fast path. */
export class StartBuffer {
  private target=0;
  private latency=false;
  private headroomRisk=false;
  private headroom:number|null=null;
  private maxTtfb=0;
  observe(delivery:DeliverySample,mediaBitrateBps:number|null){
    if(!delivery.requests)return;
    this.maxTtfb=Math.max(this.maxTtfb,delivery.maxTtfbMs);
    this.headroom=delivery.goodputBps!==null&&mediaBitrateBps!==null&&mediaBitrateBps>0?delivery.goodputBps/mediaBitrateBps:null;
    this.latency ||= this.maxTtfb>=250;
    this.headroomRisk ||= this.headroom!==null&&this.headroom<1.3;
    if(this.latency||this.headroomRisk)this.target=Math.max(this.target,Math.min(1.8,Math.max(0.75,this.maxTtfb*0.002,this.headroomRisk?1.8:0)));
  }
  get targetSeconds(){return this.target;}
  result(heldMilliseconds:number,bufferedSeconds:number,capped:boolean):StartBufferResult{
    return{reason:this.latency?(this.headroomRisk?'latency-and-headroom':'latency'):this.headroomRisk?'headroom':'healthy',
      heldMilliseconds,targetSeconds:this.target,bufferedSeconds,headroom:this.headroom,maxTtfbMilliseconds:this.maxTtfb,capped};
  }
}
