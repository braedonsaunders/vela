import type {Rendition} from '../model';

/** Conversion rungs are expensive. Auto starts on the producing rung and only
 * steps down on a sustained measured stall; it never probes another encoder. */
export class CoreQuality {
  private selected:string|null=null;
  private locked:string|null=null;
  private since=0;
  private stalled:number|null=null;
  private switched=-Infinity;
  get id(){return this.selected;}
  get manual(){return this.locked;}
  reset(){this.selected=null;this.locked=null;this.since=0;this.stalled=null;this.switched=-Infinity;}
  choose(ladder:readonly Rendition[],initial:string|undefined,now=performance.now()):Rendition|undefined{
    const current=ladder.find(r=>r.id===(this.locked??this.selected));
    const selected=current??ladder.find(r=>r.id===initial)??ladder[0];
    if(selected&&selected.id!==this.selected){this.selected=selected.id;this.since=now;this.stalled=null;}
    return selected;
  }
  pin(id:string|null,ladder:readonly Rendition[]){
    if(id&&!ladder.some(r=>r.id===id))throw new Error('Unknown quality rendition');
    this.locked=id;this.stalled=null;
    // Auto keeps the currently playing level, rather than restarting the base.
    if(id){this.selected=id;this.since=performance.now();}
  }
  sample(ladder:readonly Rendition[],waiting:boolean,throughput:number|null,now=performance.now()):Rendition|undefined{
    if(this.locked||!this.selected||now-this.since<10000||now-this.switched<30000)return;
    const current=ladder.find(r=>r.id===this.selected);if(!current)return;
    if(!waiting){this.stalled=null;return;}
    this.stalled??=now;if(now-this.stalled<5000)return;
    const lower=ladder.filter(r=>r.bandwidth<current.bandwidth).sort((a,b)=>a.bandwidth-b.bandwidth);
    const next=throughput===null?lower.at(-1):lower.filter(r=>r.bandwidth*1.4<throughput).at(-1)??lower[0];
    if(!next)return;
    this.selected=next.id;this.since=now;this.switched=now;this.stalled=null;return next;
  }
}
