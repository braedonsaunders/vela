import type {ByteReader} from '../../core/types';
import {SubtitleReadScope,integer,text,vint,type Element} from './binary';
import {subtitleIdentity} from './identity';
import type {SubtitleContainer,SubtitleDescription,SubtitleFont,SubtitlePacket,SubtitlePacketWindow,SubtitleTrack,SubtitleCodec} from './types';
const ID={segment:0x18538067,info:0x1549a966,tracks:0x1654ae6b,cluster:0x1f43b675,cues:0x1c53bb6b,attachments:0x1941a469,seekHead:0x114d9b74};
interface Track {public:SubtitleTrack;number:number;configuration:Uint8Array|null;defaultDuration:number|null;unsupported:string|null}
interface Cue {time:number;cluster:number;track:number;duration:number|null}
const codecs:Record<string,SubtitleCodec>={'S_TEXT/UTF8':'srt','S_TEXT/ASS':'ass','S_TEXT/SSA':'ssa','S_HDMV/PGS':'pgs'};
/** Subtitle-only EBML parser over the core's borrowed source/cache. */
export class MatroskaSubtitles implements SubtitleContainer {
  readonly tracks:SubtitleTrack[]=[];readonly fonts:SubtitleFont[]=[];
  private actual=new Map<string,Track>();private segment!:Element;private firstCluster=0;private scale=0.001;
  private history:{id:string;start:number;end:number;packets:SubtitlePacket[]}|null=null;
  private size=0;private disposed=false;private seeks=new Map<number,number>();private cues:Cue[]|null=null;
  constructor(private reader:ByteReader,private descriptions:readonly SubtitleDescription[]=[]){ }
  async open(signal:AbortSignal):Promise<this>{
    this.size=await this.reader.size(signal);const scope=this.scope(signal);
    for(let at=0;at<this.size;){const element=await scope.ebml(at);if(element.id===ID.segment){this.segment=element;break}if(element.unknown)throw new Error('Invalid subtitle segment header');at=element.end}
    if(!this.segment)throw new Error('Subtitle source has no Matroska segment');
    const seen=new Set<number>();
    const parse=async(element:Element)=>{
      if(seen.has(element.start))return;seen.add(element.start);
      if(element.id===ID.seekHead)await this.seekHead(scope,element);
      if(element.id===ID.info)await scope.children(element,async item=>{if(item.id===0x2ad7b1){this.scale=await scope.number(item)/1e9;if(!Number.isFinite(this.scale)||this.scale<=0)throw new Error('Invalid subtitle timestamp scale')}});
      if(element.id===ID.tracks)await this.readTracks(scope,element);
      if(element.id===ID.attachments)await this.readFonts(scope,element);
    };
    for(let at=this.segment.data;at<this.segment.end;){const item=await scope.ebml(at,this.segment.end);if(item.id===ID.cluster){this.firstCluster=at;break}await parse(item);if(item.unknown)throw new Error('Invalid subtitle metadata size');at=item.end}
    for(const id of [ID.info,ID.tracks,ID.attachments]){const at=this.seeks.get(id);if(at!==undefined)await parse(await scope.ebml(at,this.segment.end))}
    if(!this.firstCluster&&this.tracks.length)throw new Error('Subtitle source contains no media clusters');return this;
  }
  private scope(signal:AbortSignal){if(this.disposed)throw new DOMException('Subtitle container retired','AbortError');return new SubtitleReadScope(this.reader,this.size,signal)}
  private async seekHead(scope:SubtitleReadScope,element:Element){
    await scope.children(element,async seek=>{if(seek.id!==0x4dbb)return;let id=0,position=-1;await scope.children(seek,async item=>{if(item.id===0x53ab)id=integer(await scope.value(item,4));if(item.id===0x53ac)position=await scope.number(item)});
      if(position>=0&&this.segment.data+position<this.segment.end)this.seeks.set(id,this.segment.data+position);
    });
  }
  private async readTracks(scope:SubtitleReadScope,element:Element){
    // All TrackEntry records count, including AV, subtitles and unrecognized types.
    let streamIndex=0;const numbers=new Set<number>();
    await scope.children(element,async entry=>{
      if(entry.id!==0xae)return;const index=streamIndex++;let number=0,type=0,codec='',language='und',ietf='',label='',defaultTrack=true,forced=false,privateElement:Element|null=null,defaultDuration:number|null=null,encoded=false,transformed=false;
      await scope.children(entry,async item=>{
        switch(item.id){case 0xd7:number=await scope.number(item);break;case 0x83:type=await scope.number(item);break;case 0x86:codec=text(await scope.value(item,256));break;
          case 0x22b59c:language=text(await scope.value(item,64));break;case 0x22b59d:ietf=text(await scope.value(item,64));break;case 0x536e:label=text(await scope.value(item,512));break;
          case 0x88:defaultTrack=!!await scope.number(item);break;case 0x55aa:forced=!!await scope.number(item);break;case 0x63a2:privateElement=item;break;
          case 0x23e383:defaultDuration=await scope.number(item)/1e9;break;case 0x6d80:encoded=true;break;
          case 0x56aa:case 0x537f:transformed ||= !!await scope.number(item);break;
          case 0x23314f:{const bytes=await scope.value(item,8),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);transformed ||= (bytes.length===4?view.getFloat32(0):bytes.length===8?view.getFloat64(0):NaN)!==1;break}
        }
      });
      if(number<=0||numbers.has(number))throw new Error('Ambiguous Matroska subtitle track number');numbers.add(number);
      if(type!==17||!codecs[codec])return;
      const configuration=privateElement?await scope.value(privateElement,4*1024*1024):null;
      const actual=subtitleIdentity('mkv',number,index,codecs[codec],ietf||language,label,defaultTrack,forced,this.descriptions);
      this.tracks.push(actual);this.actual.set(actual.id,{public:actual,number,configuration,defaultDuration,unsupported:encoded?'Encoded/encrypted subtitle track requires server rendering':transformed?'Nonstandard subtitle track time transform requires server rendering':null});
    });
  }
  private async readFonts(scope:SubtitleReadScope,element:Element){
    await scope.children(element,async file=>{if(file.id!==0x61a7)return;let name='',mime='',data:Element|null=null;
      await scope.children(file,async item=>{if(item.id===0x466e)name=text(await scope.value(item,512));if(item.id===0x4660)mime=text(await scope.value(item,128));if(item.id===0x465c)data=item});
      const blob=data as Element|null;if(!blob||!(/\.(?:ttf|otf|woff2?)$/i.test(name)||/font|truetype|opentype/i.test(mime)))return;
      if(this.fonts.length>=256)throw new Error('Subtitle font inventory exceeds bound');const at=blob.data,size=blob.end-blob.data;
      this.fonts.push({name,mime,size,read:async signal=>{if(size>8*1024*1024)throw new Error('Subtitle font exceeds size bound');return this.scope(signal).read(at,size)}});
    });
  }
  configuration(id:string){return this.actual.get(id)?.configuration?.slice()??null}
  private async loadCues(scope:SubtitleReadScope){
    if(this.cues)return;const result:Cue[]=[];const at=this.seeks.get(ID.cues);if(at===undefined){this.cues=[];return}
    const root=await scope.ebml(at,this.segment.end);if(root.id!==ID.cues)throw new Error('Invalid subtitle cue index');
    await scope.children(root,async point=>{if(point.id!==0xbb)return;let time=0;const positions:{track:number;cluster:number;duration:number|null}[]=[];
      await scope.children(point,async item=>{if(item.id===0xb3)time=await scope.number(item)*this.scale;
        if(item.id===0xb7){let track=0,cluster=-1,duration:number|null=null;await scope.children(item,async position=>{if(position.id===0xf7)track=await scope.number(position);if(position.id===0xf1)cluster=this.segment.data+await scope.number(position);if(position.id===0xb2)duration=await scope.number(position)*this.scale});if(track&&cluster>=this.segment.data&&cluster<this.segment.end)positions.push({track,cluster,duration})}
      });
      for(const position of positions){if(result.length>=100000)throw new Error('Subtitle cue index exceeds bound');result.push({time,...position})}
    });
    scope.signal.throwIfAborted();this.cues=result.sort((a,b)=>a.time-b.time||a.cluster-b.cluster);
  }
  private async block(scope:SubtitleReadScope,element:Element,clusterTime:number,duration:number|null,track:Track):Promise<SubtitlePacket|null>{
    const length=element.end-element.data;if(length<4)return null;const header=await scope.read(element.data,Math.min(11,length)),id=vint(header,0);
    if(id.value!==track.number)return null;const at=id.length;if(header.length<at+3)throw new Error('Truncated subtitle block');
    if(header[at+2]&6)throw new Error('Laced subtitle blocks require server rendering');
    const relative=new DataView(header.buffer,header.byteOffset+at,2).getInt16(0),offset=at+3;
    return {time:(clusterTime+relative)*this.scale,duration:duration===null?track.defaultDuration:duration*this.scale,data:await scope.read(element.data+offset,length-offset)};
  }
  private async cluster(scope:SubtitleReadScope,position:number,track:Track,begin:number,end:number):Promise<{next:number;time:number;packets:SubtitlePacket[]}>{
    const cluster=await scope.ebml(position,this.segment.end);if(cluster.id!==ID.cluster)return {next:cluster.end,time:Infinity,packets:[]};
    let time=0,known=false,at=cluster.data;const packets:SubtitlePacket[]=[];
    while(at<cluster.end){const item=await scope.ebml(at,cluster.end);
      if(cluster.unknown&&Object.values(ID).includes(item.id)){break}
      if(item.id===0xe7){time=await scope.number(item);known=true;if(time*this.scale>end)break}
      else if(item.id===0xa3||item.id===0xa0){
        if(!known)throw new Error('Subtitle cluster has no leading timestamp');let packet:SubtitlePacket|null=null;
        if(item.id===0xa3)packet=await this.block(scope,item,time,null,track);
        else {let block:Element|null=null,duration:number|null=null;await scope.children(item,async group=>{if(group.id===0xa1)block=group;if(group.id===0x9b)duration=await scope.number(group)});if(block)packet=await this.block(scope,block,time,duration,track)}
        if(packet&&packet.time<=end&&(packet.duration===null||packet.time+packet.duration>begin)){if(packets.length>=4096)throw new Error('Subtitle packet window exceeds bound');packets.push(packet)}
      }
      if(item.unknown)throw new Error('Invalid subtitle block size');at=item.end;
    }
    return {next:cluster.unknown?at:cluster.end,time:time*this.scale,packets};
  }
  async packets(id:string,start:number,end:number,signal:AbortSignal):Promise<SubtitlePacketWindow>{
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||end-start>60)throw new Error('Invalid subtitle packet window');const track=this.actual.get(id);if(!track)throw new Error('Unknown actual subtitle track');if(track.unsupported)throw new Error(track.unsupported);
    const scope=this.scope(signal);await this.loadCues(scope);const cues=this.cues!,own=cues.filter(cue=>cue.track===track.number);
    const preceding=cues.filter(cue=>cue.time<=start);const nearest=preceding.at(-1);let initial=nearest?.cluster??this.firstCluster;
    const extra=new Set<number>();
    // Long ASS/text events are fetched at their indexed original clusters, not by scanning intervening video.
    for(const cue of own)if(cue.time<=start&&cue.duration!==null&&cue.time+cue.duration>start)extra.add(cue.cluster);
    if(track.public.codec==='pgs')for(const cue of own.filter(cue=>cue.time<=start).slice(-8))extra.add(cue.cluster);
    const packets:SubtitlePacket[]=[];const visited=new Set<number>();
    for(const cluster of [...extra].sort((a,b)=>a-b)){const data=await this.cluster(scope,cluster,track,track.public.codec==='pgs'?0:start,end);packets.push(...data.packets);visited.add(cluster)}
    let clusters=0;
    for(let at=initial;at<this.segment.end;){if(++clusters>128)throw new Error('Subtitle seek acquisition index is unavailable');const element=await scope.ebml(at,this.segment.end);
      if(element.id!==ID.cluster){if(element.unknown)break;at=element.end;continue}
      const result=await this.cluster(scope,at,track,start,end);if(!visited.has(at))packets.push(...result.packets);if(result.time>end)break;if(result.next<=at)throw new Error('Invalid subtitle cluster boundary');at=result.next;
    }
    if(packets.length>8192)throw new Error('Subtitle packet window exceeds bound');scope.signal.throwIfAborted();
    const fromStart=initial===this.firstCluster,previous=this.history;
    // Cues need not index every text event. Only a scan from the beginning, or
    // overlapping continuation of such a scan, proves long-cue history complete.
    const completeHistory=fromStart||!!previous&&previous.id===id&&start>=previous.start&&start<=previous.end;
    if(completeHistory&&track.public.codec!=='pgs'){
      const prior=previous?.id===id&&start>=previous.start&&start<=previous.end?previous.packets.filter(packet=>packet.duration===null||packet.time+packet.duration>start):[];
      const unique=new Map<string,SubtitlePacket[]>();for(const packet of [...prior,...packets]){const key=[packet.time,packet.duration,packet.data.length].join(':'),bucket=unique.get(key)??[];
        if(!bucket.some(other=>other.data.every((byte,index)=>byte===packet.data[index])))bucket.push(packet);unique.set(key,bucket)}
      packets.splice(0,packets.length,...[...unique.values()].flat());
      if(packets.length>8192||packets.reduce((sum,packet)=>sum+packet.data.length,0)>16*1024*1024)throw new Error('Subtitle history exceeds bound');
      this.history={id,start,end,packets:[...packets]};
    }
    return {packets:packets.sort((a,b)=>a.time-b.time),fromStart,completeHistory};
  }
  dispose(){this.disposed=true;this.actual.clear();this.cues=null;this.history=null;this.fonts.length=0}
}
