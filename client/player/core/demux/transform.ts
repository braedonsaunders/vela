/** Source-complete build adaptation; the pinned MPL library stays pristine. */
export function transformCoreDemux(path:string,source:string):string|null{
  const normalized=path.replaceAll('\\','/');
  if(normalized.endsWith('/src/hls/hls-segmented-input.ts')){
    const anchor='input._onFormatDetermined = (format) => {';
    if(source.split(anchor).length!==2)throw new Error('Pinned HLS source clock hook changed');
    const module=JSON.stringify(new URL('./fragment-time.ts',import.meta.url).pathname);
    return `import {inheritFragmentTiming} from ${module};\n`+source.replace(anchor,'inheritFragmentTiming(this.input._rootSource,input._rootSource);\n\t\t'+anchor);
  }
  if(!normalized.endsWith('/src/isobmff/isobmff-demuxer.ts'))return null;
  const anchor='const baseMediaDecodeTime = version === 0 ? readU32Be(slice) : readU64Be(slice);';
  if(source.split(anchor).length!==2)throw new Error('Pinned fragment clock hook changed');
  const module=JSON.stringify(new URL('./fragment-time.ts',import.meta.url).pathname);
  return `import {fragmentDecodeTime} from ${module};\n`+source.replace(anchor,
    'const baseMediaDecodeTime = version === 0 ? readU32Be(slice) : fragmentDecodeTime(this.input._rootSource,this.currentTrack,readU32Be(slice),readU32Be(slice));');
}
