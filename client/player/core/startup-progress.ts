/** Startup owns one progress clock from source admission through PCM priming.
 * The reserve is unchanged; slow flowing data may wait, a stuck route may not. */
export class StartupProgress {
  readonly signal:AbortSignal;
  private readonly abort=new AbortController();
  private readonly began=performance.now();
  private lastProgress=this.began;
  private counters:number[];
  private timer?:ReturnType<typeof setInterval>;
  constructor(private readonly parent:AbortSignal,private readonly read:()=>readonly number[]){
    this.signal=AbortSignal.any([parent,this.abort.signal]);this.counters=[...read()];
    parent.addEventListener('abort',this.dispose,{once:true});
    if(parent.aborted)return;
    this.timer=setInterval(()=>this.observe(),100);
  }
  observe(){
    if(this.signal.aborted){this.dispose();return;}
    const now=performance.now(),next=[...this.read()];
    if(next.some((value,index)=>Number.isFinite(value)&&value>(this.counters[index]??0)))this.lastProgress=now;
    this.counters=next;
    const ceiling=now-this.began>=45000,stalled=now-this.lastProgress>=8000;
    if(ceiling||stalled){this.abort.abort(new Error(ceiling?'Core startup exceeded 45-second hard ceiling':'Core startup made no byte, packet or PCM progress for 8 seconds'));this.dispose();}
  }
  readonly dispose=()=>{if(this.timer)clearInterval(this.timer);this.timer=undefined;this.parent.removeEventListener('abort',this.dispose);};
}
