import type {EncodedPacket} from './types';

/** Encoded read-ahead overlaps byte-range reads with parser/GPU work. It never
 * changes packet order or skips the keyframe preroll needed for an exact seek.
 * Bounds: 64 queued packets, 12 MiB, 6 seconds; one bounded packet may be in flight. */
export async function* bufferedPackets(source:AsyncIterable<EncodedPacket>,signal:AbortSignal):AsyncGenerator<EncodedPacket>{
  const queue:EncodedPacket[]=[];let bytes=0,durationUs=0,done=false,closed=false,failure:unknown;
  const waiters=new Set<()=>void>(),iterator=source[Symbol.asyncIterator]();
  const wake=()=>{for(const waiter of [...waiters])waiter();};
  const changed=()=>new Promise<void>((resolve,reject)=>{
    signal.throwIfAborted();const clear=()=>{waiters.delete(change);signal.removeEventListener('abort',abort);};
    const change=()=>{clear();resolve();},abort=()=>{clear();reject(signal.reason);};
    waiters.add(change);signal.addEventListener('abort',abort,{once:true});
  });
  const producer=(async()=>{
    try{
      while(!closed){
        while(!closed&&(queue.length>=64||bytes>=12*1024*1024||durationUs>=6000000))await changed();
        if(closed)break;signal.throwIfAborted();const next=await iterator.next();if(next.done)break;
        const packet=next.value;
        while(!closed&&queue.length>0&&(bytes+packet.data.length>12*1024*1024||durationUs+packet.durationUs>6000000))await changed();
        if(closed)break;queue.push(packet);bytes+=packet.data.length;durationUs+=packet.durationUs;wake();
      }
    }catch(error){failure=error;}finally{done=true;wake();}
  })();
  try{
    for(;;){signal.throwIfAborted();if(queue.length){const packet=queue.shift()!;bytes-=packet.data.length;durationUs-=packet.durationUs;wake();yield packet;continue;}
      if(done){if(failure)throw failure;return;}await changed();}
  }finally{
    closed=true;queue.length=0;wake();
    // Caller epoch cancellation aborts an in-flight source read; never let its
    // cleanup delay replacement playback or reject as an unhandled promise.
    void producer.finally(()=>iterator.return?.()).catch(()=>{});
  }
}
