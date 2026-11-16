import type {DeliverySample} from './source/delivery';

export interface StartBufferResult {
  reason:'healthy'|'latency'|'headroom'|'latency-and-headroom'|'forward-reserve'|'cap-wait'|'unmeasured';
  heldMilliseconds:number;
  targetSeconds:number;
  bufferedSeconds:number;
  headroom:number|null;
  maxTtfbMilliseconds:number;
  capped:boolean;
  forwardBytes:number;
  forwardSeconds:number|null;
  sampleBytes:number;
  sampleWindowMilliseconds:number;
  capWaitMilliseconds:number|null;
}

/** Fast admission requires observed delivery AND contiguous media reserve.
 * Decoder/PCM/output bounds and the media clock are unchanged. */
export class StartBuffer {
  private target=1.8;
  private headroom:number|null=null;
  private maxTtfb=0;
  private forwardBytes=0;
  private forwardSeconds:number|null=null;
  private sampleBytes=0;
  private windowMs=0;
  private capWait:number|null=null;
  observe(delivery:DeliverySample,mediaBitrateBps:number|null,forwardBytes=0,capWaitMs:number|null=delivery.capWaitMs){
    this.maxTtfb=Math.max(this.maxTtfb,delivery.maxTtfbMs);
    const rate=mediaBitrateBps!==null&&Number.isFinite(mediaBitrateBps)&&mediaBitrateBps>0?mediaBitrateBps:null;
    this.headroom=delivery.goodputBps!==null&&rate!==null?delivery.goodputBps/rate:null;
    this.forwardBytes=Math.max(0,forwardBytes);this.forwardSeconds=rate===null?null:this.forwardBytes*8/rate;
    this.sampleBytes=delivery.bytes;this.windowMs=delivery.windowMs;this.capWait=capWaitMs;
    const measured=delivery.windowMs>=250&&delivery.bytes>=Math.min(1024*1024,(rate??Infinity)/16);
    this.target=measured&&this.headroom!==null&&this.headroom>=1.3&&this.forwardSeconds!==null&&this.forwardSeconds>=2&&capWaitMs===0?0.4:1.8;
  }
  get targetSeconds(){return this.target;}
  result(heldMilliseconds:number,bufferedSeconds:number,capped:boolean):StartBufferResult{
    const latency=this.maxTtfb>=250,risk=this.headroom===null||this.headroom<1.3;
    const reason=this.target===0.4?'healthy':this.capWait===null?'unmeasured':this.capWait>0?'cap-wait':risk?(latency?'latency-and-headroom':'headroom'):this.forwardSeconds===null||this.forwardSeconds<2?'forward-reserve':'unmeasured';
    return{reason,
      heldMilliseconds,targetSeconds:this.target,bufferedSeconds,headroom:this.headroom,maxTtfbMilliseconds:this.maxTtfb,capped,
      forwardBytes:this.forwardBytes,forwardSeconds:this.forwardSeconds,sampleBytes:this.sampleBytes,sampleWindowMilliseconds:this.windowMs,capWaitMilliseconds:this.capWait};
  }
}
