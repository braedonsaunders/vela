/** Source-complete build adaptation; the pinned MPL library stays pristine. */
export function transformCoreDemux(path:string,source:string):string|null{
  const normalized=path.replaceAll('\\','/');
  if(normalized.endsWith('/src/input-format.ts')){
    // The pinned MP4 probe recognizes styp only at byte zero. Ether can retain
    // valid free/skip padding before a fragment's styp. Its existing bounded
    // box walk must recognize that segment header after skipping the padding.
    // Ether emits free-box keepalives while an encode is pending. Their count
    // is arbitrary. A fetched HLS object's finite byte length bounds the walk;
    // every box consumes at least eight bytes. Skip payloads, yield for source
    // cancellation, and retain the conservative pin limit for unknown sizes.
    const anchor="fourCc === 'moof'";
    const loop='for (let iter = 0; iter < 10; iter++)';
    const size='if (size < headerSize) {';
    const header='let slice = input._reader.requestSlice(pos, 8);';
    if([anchor,loop,size,header].some(value=>source.split(value).length!==2))throw new Error('Pinned padded MP4 format probe changed');
    return source.replace(anchor,"fourCc === 'moof'\n\t\t\t\t|| fourCc === 'styp'")
      .replace(loop,`const probeSize = input._reader.fileSizeNonStrict;
        const probeBoxes = probeSize !== null && Number.isSafeInteger(probeSize) ? Math.floor(probeSize / 8) : 10;
        for (let iter = 0; iter < probeBoxes; iter++)`)
      .replace(header,`if (iter % 1024 === 1023) await new Promise<void>(resolve => setTimeout(resolve, 0));
            let slice = input._reader.requestSlice(pos, 8);`)
      .replace(size,'if (size < headerSize || !Number.isSafeInteger(size) || !Number.isSafeInteger(pos + size)) {');
  }
  if(normalized.endsWith('/src/hls/hls-segmented-input.ts')){
    const anchor='input._onFormatDetermined = (format) => {';
    if(source.split(anchor).length!==2)throw new Error('Pinned HLS source clock hook changed');
    const module=JSON.stringify(new URL('./fragment-time.ts',import.meta.url).pathname);
    return `import {inheritFragmentTiming,contextualizeHlsInput} from ${module};\n`+source.replace(anchor,'inheritFragmentTiming(this.input._rootSource,input._rootSource);\n\t\tcontextualizeHlsInput(input,hlsSegment.index);\n\t\t'+anchor);
  }
  if(!normalized.endsWith('/src/isobmff/isobmff-demuxer.ts'))return null;
  const anchor='const baseMediaDecodeTime = version === 0 ? readU32Be(slice) : readU64Be(slice);';
  if(source.split(anchor).length!==2)throw new Error('Pinned fragment clock hook changed');
  const module=JSON.stringify(new URL('./fragment-time.ts',import.meta.url).pathname);
  return `import {fragmentDecodeTime} from ${module};\n`+source.replace(anchor,
    'const baseMediaDecodeTime = version === 0 ? readU32Be(slice) : fragmentDecodeTime(this.input._rootSource,this.currentTrack,readU32Be(slice),readU32Be(slice));');
}
