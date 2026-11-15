import type {ByteReader} from '../types';
import type {SubtitleCluster,SubtitleClusterStream} from '../../universal/subtitles/types';

type ClusterBytes=Omit<SubtitleCluster,'epoch'>;
const observers=new WeakMap<object,(cluster:ClusterBytes)=>void>();
export function observeSubtitleClusters(source:object,receive:(cluster:ClusterBytes)=>void){observers.set(source,receive);return()=>{if(observers.get(source)===receive)observers.delete(source)}}
/** Called synchronously by the library while its already-read cluster is borrowed. */
export function publishSubtitleCluster(source:object,position:number,payloadStart:number,bytes:Uint8Array,time:number,endTime:number){
  observers.get(source)?.({position,payloadStart,bytes,time,endTime});
}
type Hint=Omit<SubtitleCluster,'bytes'> & {length:number};
/** Position hints only. The core's reader owns all byte caching and acquisition. */
export class MatroskaSubtitleStream implements SubtitleClusterStream {
  epoch=0;
  private hints:Hint[]=[];
  private listeners=new Set<(cluster:SubtitleCluster)=>void>();
  constructor(private reader:ByteReader,private signal:AbortSignal){signal.addEventListener('abort',()=>{this.hints=[];this.listeners.clear()},{once:true})}
  reset(epoch:number){this.epoch=epoch;this.hints=[];}
  readonly receive=(cluster:ClusterBytes)=>{
    if(this.signal.aborted||!Number.isFinite(cluster.time)||cluster.time<0||!Number.isFinite(cluster.endTime)||cluster.endTime<cluster.time||!Number.isSafeInteger(cluster.position)||!Number.isSafeInteger(cluster.payloadStart)||cluster.bytes.length>32*1024*1024)return;
    const value={...cluster,epoch:this.epoch};
    this.hints=this.hints.filter(hint=>hint.position!==cluster.position);
    this.hints.push({epoch:this.epoch,position:cluster.position,payloadStart:cluster.payloadStart,time:cluster.time,endTime:cluster.endTime,length:cluster.bytes.length});
    if(this.hints.length>64)this.hints.shift();
    this.emit(value);
  };
  private emit(cluster:SubtitleCluster){for(const listener of this.listeners){try{listener(cluster)}catch{/* A subtitle consumer cannot fail the AV demux. */}}}
  subscribe(receive:(cluster:SubtitleCluster)=>void){this.listeners.add(receive);return()=>{this.listeners.delete(receive)}}
  async replay(position:number,signal:AbortSignal){
    if(!Number.isFinite(position)||position<0)throw new Error('Invalid subtitle replay position');
    const epoch=this.epoch,operation=AbortSignal.any([signal,this.signal,AbortSignal.timeout(8000)]);
    const ordered=this.hints.filter(hint=>hint.epoch===epoch).sort((a,b)=>a.time-b.time);
    const covering=ordered.filter(hint=>hint.time<=position&&hint.endTime+1e-6>=position).at(-1);
    const previous=covering?ordered.find(hint=>hint!==covering&&hint.payloadStart+hint.length===covering.position&&hint.time>=position-4):undefined;
    const selected=[...(previous?[previous]:[]),...(covering?[covering]:[]),
      ...ordered.filter(hint=>hint.time>position&&hint.time<=position+4).slice(0,2)];
    let total=0;
    for(const hint of selected){
      operation.throwIfAborted();if(this.epoch!==epoch)throw new DOMException('Subtitle replay retired','AbortError');
      total+=hint.length;if(total>48*1024*1024)throw new Error('Subtitle cluster look-ahead exceeds bound');
      const bytes=await this.reader.read(hint.payloadStart,hint.length,operation);
      operation.throwIfAborted();if(this.epoch!==epoch)throw new DOMException('Subtitle replay retired','AbortError');
      this.emit({...hint,bytes});
    }
  }
}
