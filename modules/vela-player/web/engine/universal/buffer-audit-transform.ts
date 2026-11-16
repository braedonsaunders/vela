/** Opt-in diagnostic build hook, with identical demux/read-ahead policy. */
export function transformBufferAudit(path:string,source:string):string|null {
  if(!path.replaceAll('\\','/').endsWith('/src/matroska/matroska-demuxer.ts'))return null;
  const anchor='packet._internal = cluster.elementStartPos;';
  if(source.split(anchor).length!==2)throw new Error('Pinned buffer audit hook changed');
  const module=JSON.stringify(new URL('./buffer-audit.ts',import.meta.url).pathname);
  return `import {observeBufferPacket} from ${module};\n`+source.replace(anchor,anchor+`
    const auditKind = this.internalTrack.info?.type;
    if (!options.metadataOnly && (auditKind === 'video' || auditKind === 'audio')) {
      observeBufferPacket(this.internalTrack.demuxer.input._rootSource,auditKind,
        cluster.elementStartPos,cluster.elementEndPos,packet.timestamp+packet.duration,
        this.internalTrack.cuePoints,segment.timestampFactor);
    }`);
}
