import { Input, UrlSource, ALL_FORMATS } from 'mediabunny';
import { requireValidByteRangeResponse } from '../../../../vendor/webgpu-player/src/demux/HTTPRangeResponse';
import { requireSuccessfulMediaHTTPResponse } from '../../../../vendor/webgpu-player/src/demux/MediaFetchPolicy';
import { readWaveFormatAudioTrack } from '../../../../vendor/webgpu-player/src/demux/WaveFormatAudioConfiguration';
import type { CustomDecodeAudioMetadataLayout } from '../../../../vendor/webgpu-player/src/pipeline/DecodeWorkerProtocol';
import { canonicalAudioCodec } from './packages';
import { isSupportedCustomAudioInputLayout } from '../../../../vendor/webgpu-player/src/audio/CustomAudioOutputPolicy';
import { getQualifiedCustomWaveChannelLayout } from '../../../../vendor/webgpu-player/src/audio/processing/CustomWaveChannelLayout';
import { velaContainerCodec } from './ffmpeg/track-configuration';
import { createAudioPackages, prepareAudioOptions, type VelaAudioOptions } from './upstream';

export interface OriginalAudioIdentity {
  id: string; codec: string; streamIndex: number; channels?: number; sampleRate?: number;
  channelMask?: number | null; nativeSupported?: boolean; language?: string;
}
export interface PreparedOriginalAudioSwitch {
  ordinal: number; audioOptions: VelaAudioOptions; audioMetadataLayout?: CustomDecodeAudioMetadataLayout;
  actualTrack: OriginalAudioIdentity & { channels: number; sampleRate: number; channelMask: number | null;
    nativeSupported: boolean; language: string; decoderConfig: AudioDecoderConfig | null; containerTrackId: number | null };
}

/** Prepare against the original source before touching the active controller.
 * StreamIndex is the broker's source stream index, not a container track number.
 * Complete, ordered audio inventories + actual metadata must agree; never choose
 * the nearest language/codec when a track or source identity has changed. */
export async function prepareOriginalAudioSwitch(options: {
  url: string; tracks: readonly OriginalAudioIdentity[]; trackId: string;
  registry: ReturnType<typeof createAudioPackages>; maximumOutputChannels: number | null;
  signal: AbortSignal; nightMode?: boolean;
}): Promise<PreparedOriginalAudioSwitch> {
  const ordered = [...options.tracks].sort((a, b) => a.streamIndex - b.streamIndex);
  if (!ordered.length || ordered.some((track, index) => !track.id || !track.codec || !Number.isSafeInteger(track.streamIndex) ||
      track.streamIndex < 0 || ordered.some((other, otherIndex) => index !== otherIndex && (other.id === track.id || other.streamIndex === track.streamIndex))))
    throw new Error('Original audio stream identities are incomplete or duplicated');
  const ordinal = ordered.findIndex(track => track.id === options.trackId);
  if (ordinal < 0) throw new Error('Selected original audio track is not advertised');
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]);
  signal.throwIfAborted();
  const parsed = new URL(options.url);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Original audio requires a scoped HTTP range source');
  let reservedBytes = 0, totalBytes: number | null = null, etag: string | null = null;
  const source = new UrlSource(parsed.href, { maxCacheSize: 8 * 1024 * 1024, readAhead: 65536, parallelism: 1,
    getRetryDelay: (attempt, error) => error instanceof MetadataReadError || attempt > 2 ? null : 0.25 * 2 ** attempt,
    fetchFn: async (url, init) => {
      signal.throwIfAborted();
      const headers = new Headers(init?.headers);
      const range = /^bytes=(\d+)-(\d*)$/i.exec(headers.get('Range') ?? '');
      if (!range) throw new MetadataReadError('Original audio metadata needs an explicit byte range');
      const start = Number(range[1]);
      if (!Number.isSafeInteger(start) || start < 0) throw new MetadataReadError('Invalid original audio range');
      // UrlSource uses resumable open-ended reads. The fork explicitly supports
      // capped responses; cap the actual HTTP request, then validate that request.
      const end = Math.min(start + 256 * 1024 - 1, range[2] ? Number(range[2]) : Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(end) || end < start) throw new MetadataReadError('Invalid original audio range end');
      reservedBytes += end - start + 1;
      if (reservedBytes > 32 * 1024 * 1024) throw new MetadataReadError('Original audio metadata exceeded its read budget');
      headers.set('Range', `bytes=${start}-${end}`);
      const response = await fetch(url, { ...init, headers, redirect: 'error', credentials: 'same-origin',
        signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]) });
      try {
        requireSuccessfulMediaHTTPResponse(response);
        requireValidByteRangeResponse(headers.get('Range'), response, null);
        const total = /\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
        if (total) {
          const size = Number(total[1]);
          if (totalBytes !== null && totalBytes !== size) throw new MetadataReadError('Original source size changed during audio preparation');
          totalBytes = size;
        }
        const version = response.headers.get('ETag');
        if (etag !== null && version !== null && etag !== version) throw new MetadataReadError('Original source changed during audio preparation');
        etag ??= version;
        return response;
      } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
    } });
  const input = new Input({ source, formats: ALL_FORMATS });
  const abort = () => input.dispose(); signal.addEventListener('abort', abort, { once: true });
  try {
    const tracks = await input.getAudioTracks(); signal.throwIfAborted();
    if (tracks.length !== ordered.length) throw new Error('Original audio inventory differs from the advertised source');
    let selected: PreparedOriginalAudioSwitch['actualTrack'] | null = null;
    for (let index = 0; index < tracks.length; index++) {
      const track = tracks[index], expected = ordered[index];
      const [codec, internalId, channels, sampleRate, channelMask, language] = await Promise.all([
        track.getCodec(), track.getInternalCodecId(), track.getNumberOfChannels(), track.getSampleRate(), track.getChannelMask(), track.getLanguageCode()]);
      signal.throwIfAborted();
      const wave = codec === null ? readWaveFormatAudioTrack(track) : null;
      if (wave?.status === 'failed') throw new Error(`Original audio configuration is invalid: ${wave.failure}`);
      const actualCodec = codec ? canonicalAudioCodec(codec) : wave?.codec ?? velaContainerCodec(internalId);
      if (!actualCodec || actualCodec !== canonicalAudioCodec(expected.codec)) throw new Error(`Original audio codec differs for ${expected.id}`);
      if (!Number.isSafeInteger(channels) || channels < 1 || channels > 32 || !Number.isSafeInteger(sampleRate) || sampleRate < 1)
        throw new Error('Original audio format is incomplete');
      if ((expected.channels !== undefined && expected.channels !== channels) ||
          (expected.sampleRate !== undefined && expected.sampleRate !== sampleRate) ||
          (expected.channelMask && channelMask && expected.channelMask !== channelMask))
        throw new Error(`Original audio layout/rate differs for ${expected.id}`);
      if (channelMask && getQualifiedCustomWaveChannelLayout(channelMask)?.channelCount !== channels)
        throw new Error(`Original audio speaker mask is unqualified for ${expected.id}`);
      if (actualCodec.startsWith('pcm_') && channels > 2 && !channelMask)
        throw new Error(`Original multichannel PCM speaker positions are unavailable for ${expected.id}`);
      if (expected.language && normalizeLanguage(expected.language) !== normalizeLanguage(language)) throw new Error(`Original audio language differs for ${expected.id}`);
      if (index === ordinal) {
        const decoderConfig = await track.getDecoderConfig();
        let nativeSupported = false;
        if (actualCodec.startsWith('pcm_')) nativeSupported = await track.canDecode();
        else if (decoderConfig && typeof AudioDecoder === 'function') {
          try { nativeSupported = !!(await AudioDecoder.isConfigSupported(decoderConfig)).supported && await track.canDecode(); }
          catch { signal.throwIfAborted(); }
        }
        selected = { ...expected, codec: actualCodec, channels, sampleRate, channelMask,
          nativeSupported, language, decoderConfig, containerTrackId: track.containerTrackId };
      }
    }
    signal.throwIfAborted();
    if (!selected) throw new Error('Selected original audio disappeared during preparation');
    const audioOptions = await prepareAudioOptions(options.registry, selected, options.maximumOutputChannels,
      signal, options.nightMode ?? false, !selected.nativeSupported);
    signal.throwIfAborted();
    if (!isSupportedCustomAudioInputLayout(audioOptions.audioDecoder?.codec ?? selected.codec, selected.channels, selected.sampleRate))
      throw new Error('Selected original audio has no qualified decoded output layout/rate');
    return { ordinal, audioOptions, actualTrack: selected,
      ...(selected.channelMask ? { audioMetadataLayout: { channelCount: selected.channels, channelMask: selected.channelMask } } : {}) };
  } finally { signal.removeEventListener('abort', abort); input.dispose(); }
}
class MetadataReadError extends Error {}
function normalizeLanguage(value: string): string {
  const [language, ...region] = value.trim().toLowerCase().split(/[-_]/);
  const base = ({ en:'eng', fr:'fra', fre:'fra', de:'deu', ger:'deu', es:'spa', it:'ita', pt:'por', ja:'jpn', ko:'kor', zh:'zho', chi:'zho', ru:'rus', nl:'nld', dut:'nld' } as Record<string, string>)[language] ?? language;
  return [base, ...region].join('-');
}
