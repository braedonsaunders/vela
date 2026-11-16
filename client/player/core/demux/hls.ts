import { PacketDemux } from './file';
import type { SegmentReader } from '../source/segments';

/** Packet timestamps from the HLS library are playlist-relative. Vela maps them
 * onto Ether's absolute title origin once, independently of raw fMP4 tfdt. */
export class HlsDemux extends PacketDemux {
  constructor(reader:SegmentReader,signal:AbortSignal,originUs:number){
    if(!Number.isSafeInteger(originUs)||originUs<0)throw new Error('Invalid HLS title origin');
    super((current,count)=>reader.createSource(current,count),signal,reader.liveWindow?0:originUs,
      reader.liveWindow?()=>reader.liveWindow!.ended:undefined,undefined,undefined,undefined,true);
  }
}
