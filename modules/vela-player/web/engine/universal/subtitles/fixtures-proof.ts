import {deflateSync} from 'node:zlib';
import {MatroskaSubtitles} from './matroska';
import {PGSDecoder,type PGSBitmap} from './pgs';
import type {ByteReader} from '../../core/types';

// Module-level proof only: generated Matroska bytes -> packet decoding -> PGS
// RGBA -> comparison PNG. The integrated player still owns the later real-title
// browser canvas look.
class FixtureReader implements ByteReader {
  constructor(private bytes:Uint8Array){}
  async size(signal:AbortSignal){signal.throwIfAborted();return this.bytes.length}
  async read(offset:number,length:number,signal:AbortSignal){signal.throwIfAborted();return this.bytes.slice(offset,offset+length)}
  dispose(){}
}
const equal=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
async function decode(path:string){
  const bytes=new Uint8Array(await Bun.file(path).arrayBuffer()),container=await new MatroskaSubtitles(new FixtureReader(bytes)).open(new AbortController().signal),track=container.tracks[0];
  if(!track)throw new Error(`${path}: missing PGS track`);const packets=await container.packets(track.id,0,2,new AbortController().signal),decoder=new PGSDecoder();
  const displays=packets.packets.flatMap(packet=>decoder.push(packet.data,packet.time)),bitmap=displays[0]?.bitmaps[0];container.dispose();
  if(!bitmap)throw new Error(`${path}: decoded no PGS pixels`);return bitmap;
}
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(crc&1?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(kind:string,data:Uint8Array){const result=new Uint8Array(data.length+12),view=new DataView(result.buffer);view.setUint32(0,data.length);result.set(new TextEncoder().encode(kind),4);result.set(data,8);view.setUint32(data.length+8,crc32(result.subarray(4,data.length+8)));return result}
function png(bitmaps:readonly PGSBitmap[]){
  const gap=2,width=Math.max(...bitmaps.map(bitmap=>bitmap.width)),height=bitmaps.reduce((sum,bitmap)=>sum+bitmap.height,0)+gap*(bitmaps.length-1),raw=new Uint8Array((width*4+1)*height);let top=0;
  for(const bitmap of bitmaps){for(let y=0;y<bitmap.height;y++)raw.set(bitmap.rgba.subarray(y*bitmap.width*4,(y+1)*bitmap.width*4),(top+y)*(width*4+1)+1);top+=bitmap.height+gap}
  const header=new Uint8Array(13),view=new DataView(header.buffer);view.setUint32(0,width);view.setUint32(4,height);header.set([8,6,0,0,0],8);
  const signature=new Uint8Array([137,80,78,71,13,10,26,10]),ihdr=chunk('IHDR',header),idat=chunk('IDAT',deflateSync(raw)),iend=chunk('IEND',new Uint8Array());
  const result=new Uint8Array(signature.length+ihdr.length+idat.length+iend.length);let at=0;for(const part of [signature,ihdr,idat,iend]){result.set(part,at);at+=part.length}return result;
}

const directory=process.argv[2],output=process.argv[3];if(!directory||!output)throw new Error('Usage: bun fixtures-proof.ts <fixture-directory> <comparison.png>');
const names=['pgs-plain.mkv','pgs-header-strip.mkv','pgs-zlib.mkv'],bitmaps=await Promise.all(names.map(name=>decode(`${directory}/${name}`))),reference=bitmaps[0];
for(const [index,bitmap] of bitmaps.entries())if(bitmap.width!==reference.width||bitmap.height!==reference.height||!equal(bitmap.rgba,reference.rgba))throw new Error(`${names[index]} decoded pixels differ`);
const opaque=reference.rgba.filter((_,index)=>index%4===3&&reference.rgba[index]!==0).length,transparent=reference.width*reference.height-opaque;
if(!opaque||!transparent)throw new Error('PGS proof bitmap does not contain real opaque and transparent pixels');await Bun.write(output,png(bitmaps));
console.log(`Parser/decoder proof: identical ${reference.width}x${reference.height} PGS RGBA bitmaps, ${opaque} opaque and ${transparent} transparent pixels; wrote comparison PNG ${output}`);
