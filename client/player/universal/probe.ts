import { Input, UrlSource, ALL_FORMATS } from 'mediabunny';
import { requireValidByteRangeResponse } from '../../../vendor/webgpu-player/src/demux/HTTPRangeResponse';
import { requireSuccessfulMediaHTTPResponse } from '../../../vendor/webgpu-player/src/demux/MediaFetchPolicy';
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
    const [codec, width, height, config, color, fieldOrder, clockwiseRotation] = await Promise.all([video.getCodec(), video.getCodedWidth(), video.getCodedHeight(), video.getDecoderConfig(), video.getColorSpace(), video.getFieldOrder(), video.getRotation()]);
    if (!codec) throw new Error('Original video codec is unknown');
    // Use the actual container config, including private bytes and profile.
    let nativeSupported = false;
    if (config && typeof VideoDecoder === 'function') {
      try { nativeSupported = !!(await VideoDecoder.isConfigSupported({...config, hardwareAcceleration:'prefer-hardware'})).supported; }
      catch { signal.throwIfAborted(); }
    }
    signal.throwIfAborted();
    const ordered = [...media.audio].sort((a,b) => a.streamIndex-b.streamIndex);
    const selected = ordered.findIndex(a => a.id === media.selectedAudioId);
    if (selected >= 0) {
      const track = audios[selected];
      if (!track) throw new Error('Selected original audio track does not exist in the container');
      const [channels, sampleRate, channelMask, nativeSupported] = await Promise.all([track.getNumberOfChannels(), track.getSampleRate(), track.getChannelMask(), track.canDecode()]);
      if (ordered[selected].channels !== undefined && ordered[selected].channels !== channels) throw new Error('Original audio layout differs from broker metadata');
      ordered[selected] = {...ordered[selected], channels, sampleRate, channelMask, nativeSupported};
    }
    const description = config?.description;
    const privateBytes = description ? ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description) : null;
    const bitDepth = media.video.bitDepth ?? (codec === 'avc' && privateBytes && privateBytes[0] === 1 && privateBytes[1] <= 100 ? 8 : codec === 'hevc' && privateBytes && privateBytes.length >= 23 && privateBytes[0] === 1 ? 8 + (privateBytes[17] & 7) : undefined);
    const containers: Record<string,string> = {'Matroska':'mkv','MP4':'mp4','MPEG Transport Stream':'mpegts','MPEG Program Stream':'mpeg','AVI':'avi','ASF':'asf','Ogg':'ogg'};
    return {...media, container:containers[format.name] ?? format.name.toLowerCase(), audio:ordered,
      video:{...media.video, nativeSupported,
        // Positive broker SPS evidence outranks a container progressive flag.
        isInterlaced: media.video.isInterlaced === true ? true : fieldOrder ? fieldOrder !== 'progressive' : media.video.isInterlaced,
        fieldOrder: media.video.fieldOrder ?? ({progressive:'progressive','top-first':'tt','bottom-first':'bb','top-coded-bottom-first':'tb','bottom-coded-top-first':'bt'} as Record<string, OriginalMedia['video']['fieldOrder']>)[fieldOrder ?? ''],
        // Mediabunny reports clockwise; the wire uses ffprobe counterclockwise.
        rotation: media.video.rotation ?? (clockwiseRotation !== 0 ? -clockwiseRotation : undefined), codec: codec === 'avc' ? 'h264' : codec, width, height, bitDepth,
        colorPrimaries: color.primaries ?? media.video.colorPrimaries, colorTransfer: color.transfer ?? media.video.colorTransfer,
        colorSpace: color.matrix ?? media.video.colorSpace, colorRange: color.fullRange === undefined || color.fullRange === null ? media.video.colorRange : color.fullRange ? 'pc' : 'tv'}};
  } finally { signal.removeEventListener('abort', abort); input.dispose(); }
}
