import { Input, UrlSource, ALL_FORMATS } from 'mediabunny';
import { requireValidByteRangeResponse } from '../../../vendor/webgpu-player/src/demux/HTTPRangeResponse';
import { requireSuccessfulMediaHTTPResponse } from '../../../vendor/webgpu-player/src/demux/MediaFetchPolicy';
import { metadataDifference } from './diagnostics';
import type { OriginalMedia } from './source';
/** Bounded header/index inspection of the ORIGINAL; never a whole-file fallback.
 * The decode worker performs its own exact configuration validation afterwards. */
export async function probeOriginal(media: OriginalMedia, signal: AbortSignal): Promise<OriginalMedia> {
  let readBudget = 0;
  let sourceETag: string | null = null;
  let sourceSize: string | null = null;
  const source = new UrlSource(media.url, { maxCacheSize: 8 * 1024 * 1024, readAhead: 65536, parallelism: 1,
    getRetryDelay: attempts => attempts <= 2 ? 0.25 * 2 ** attempts : null,
    fetchFn: async (url, init) => {
      const headers = new Headers(init?.headers);
      const range = /^bytes=(\d+)-(\d*)$/i.exec(headers.get('Range') ?? '');
      if (!range) throw new Error('Original inspection requires an explicit byte range');
      const start = Number(range[1]);
      const end = Math.min(start + 256*1024 - 1, range[2] ? Number(range[2]) : Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end < start)
        throw new Error('Original inspection range is invalid');
      readBudget += end-start+1;
      if (readBudget > 32*1024*1024) throw new Error('Original inspection exceeded its byte budget');
      headers.set('Range', `bytes=${start}-${end}`);
      const response = await fetch(url, {...init, headers, redirect:'error', credentials:'same-origin', signal:AbortSignal.any([signal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(15000)])});
      try {
        requireSuccessfulMediaHTTPResponse(response);
        requireValidByteRangeResponse(headers.get('Range'), response, null);
        const size = /\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '')?.[1] ?? null;
        const etag = response.headers.get('ETag');
        if (sourceSize !== null && size !== sourceSize || sourceETag !== null && etag !== sourceETag)
          throw new Error('Original source changed during inspection');
        sourceSize ??= size; sourceETag ??= etag;
        return response;
      } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
    } });
  const input = new Input({source, formats: ALL_FORMATS});
  const abort = () => input.dispose();
  signal.addEventListener('abort', abort, {once:true});
  try {
    signal.throwIfAborted();
    const [format, videos, audios] = await Promise.all([input.getFormat(), input.getVideoTracks(), input.getAudioTracks()]);
    const video = videos[0]; if (!video) throw new Error('Original contains no video track');
    const [codec, width, height, config, color, fieldOrder, clockwiseRotation, stats] = await Promise.all([video.getCodec(), video.getCodedWidth(), video.getCodedHeight(), video.getDecoderConfig(), video.getColorSpace(), video.getFieldOrder(), video.getRotation(), video.computePacketStats(24).catch(() => null)]);
    if (!codec) throw new Error('Original video codec is unknown');
    // Use the actual container config, including private bytes and profile.
    let nativeSupported = false;
    if (config && typeof VideoDecoder === 'function') {
      try { nativeSupported = !!(await VideoDecoder.isConfigSupported({...config, hardwareAcceleration:'prefer-hardware'})).supported; }
      catch { signal.throwIfAborted(); }
    }
    signal.throwIfAborted();
    const duration = await input.getDurationFromMetadata().catch(() => null);
    signal.throwIfAborted();
    const notes = [...(media.discrepancies ?? [])];
    metadataDifference(notes,'duration',media.duration,duration);
    metadataDifference(notes,'audio.inventory',media.audio.length,audios.length);
    const description = config?.description;
    const privateBytes = description ? ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description) : null;
    const bitDepth = (codec === 'avc' && privateBytes && privateBytes[0] === 1 && privateBytes[1] <= 100 ? 8 : codec === 'hevc' && privateBytes && privateBytes.length >= 23 && privateBytes[0] === 1 ? 8 + (privateBytes[17] & 7) : undefined);
    const containers: Record<string,string> = {'Matroska':'mkv','MP4':'mp4','MPEG Transport Stream':'mpegts','MPEG Program Stream':'mpeg','AVI':'avi','ASF':'asf','Ogg':'ogg'};
    const actualCodec = codec === 'avc' ? 'h264' : codec;
    const profile = privateBytes?.[0] === 1 ? actualCodec === 'hevc'
      ? ({1:'Main',2:'Main 10',3:'Main Still Picture'} as Record<number,string>)[privateBytes[1] & 31]
      : actualCodec === 'h264' ? ({66:'Baseline',77:'Main',100:'High',110:'High 10',122:'High 4:2:2',244:'High 4:4:4'} as Record<number,string>)[privateBytes[1]] : undefined : undefined;
    const level = privateBytes?.[0] === 1 ? actualCodec === 'hevc' ? privateBytes[12] : actualCodec === 'h264' ? privateBytes[3] : undefined : undefined;
    const transfer = ({pq:'smpte2084',hlg:'arib-std-b67'} as Record<string,string>)[String(color.transfer)] ?? color.transfer ?? undefined;
    const matrix = ({'bt2020-ncl':'bt2020nc'} as Record<string,string>)[String(color.matrix)] ?? color.matrix ?? undefined;
    const videoFacts = {...media.video, nativeSupported, codec:actualCodec, width,height,bitDepth,
      profile,level,frameRate:stats && Number.isFinite(stats.averagePacketRate) && stats.averagePacketRate>0 ? stats.averagePacketRate : undefined,
      isInterlaced:fieldOrder ? fieldOrder !== 'progressive' : undefined,
      fieldOrder:({progressive:'progressive','top-first':'tt','bottom-first':'bb','top-coded-bottom-first':'tb','bottom-coded-top-first':'bt'} as Record<string, OriginalMedia['video']['fieldOrder']>)[fieldOrder ?? ''],
      rotation:-clockwiseRotation,
      colorPrimaries:color.primaries ?? media.video.colorPrimaries,colorTransfer:transfer ?? media.video.colorTransfer,
      colorSpace:matrix ?? media.video.colorSpace,colorRange:color.fullRange == null ? media.video.colorRange : color.fullRange ? 'pc' : 'tv'};
    for (const key of ['codec','width','height','bitDepth','profile','level','frameRate','isInterlaced','fieldOrder','rotation','colorPrimaries','colorTransfer','colorSpace','colorRange'] as const)
      metadataDifference(notes,`video.${key}`,media.video[key],videoFacts[key]);
    // Explicit HDR10-compatible DV8 base plus actual PQ/BT.2020 can use the
    // ordinary HDR10 tone mapper; do not claim RPU reconstruction on this route.
    if (videoFacts.dvProfile !== undefined && transfer && !['smpte2084','arib-std-b67'].includes(transfer)) {
      videoFacts.dvProfile = undefined; videoFacts.dvLevel = undefined;
      videoFacts.rpuPresent = undefined; videoFacts.elPresent = undefined; videoFacts.blPresent = undefined;
      notes.push('presentation: using actual SDR colour instead of conflicting Dolby Vision description');
    }
    if (videoFacts.dvProfile === 8 && videoFacts.dvBlSignalCompatibilityId === 1 && transfer === 'smpte2084' && String(color.primaries) === 'bt2020') {
      videoFacts.dvProfile = undefined; videoFacts.dvLevel = undefined;
      videoFacts.rpuPresent = undefined; videoFacts.elPresent = undefined; videoFacts.blPresent = undefined;
      notes.push('presentation: DV8 HDR10-compatible base layer, RPU not applied');
    }
    return {...media,duration,container:containers[format.name] ?? format.name.toLowerCase(),audioTrackCount:audios.length,
      video:videoFacts,discrepancies:notes.slice(0,32)};
  } finally { signal.removeEventListener('abort', abort); input.dispose(); }
}
