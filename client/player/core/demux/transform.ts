/** Source-complete build adaptation; the pinned MPL library stays pristine. */
export function transformCoreDemux(path:string,source:string):string|null{
  const normalized=path.replaceAll('\\','/');
  if(normalized.endsWith('/src/input-format.ts')){
    // The pinned MP4 probe recognizes styp only at byte zero. Ether can retain
    // valid free/skip padding before a fragment's styp. Its existing bounded
    // box walk must recognize that segment header after skipping the padding.
    // Keep the byte stream, box-size checks and subsequent demux validation.
    const anchor="fourCc === 'moof'";
    if(source.split(anchor).length!==2)throw new Error('Pinned padded MP4 format probe changed');
    return source.replace(anchor,"fourCc === 'moof'\n\t\t\t\t|| fourCc === 'styp'");
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
