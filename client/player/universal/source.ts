/** The source facts used for route selection. Actual decoder config is probed by
 * the demux/decode worker too; broker metadata is never proof of decode support. */
export interface OriginalVideo {
  codec: string; width: number; height: number; bitDepth?: number; profile?: string; nativeSupported?: boolean;
  isInterlaced?: boolean; fieldOrder?: 'progressive' | 'tt' | 'bb' | 'tb' | 'bt'; rotation?: number;
  level?: number; frameRate?: number; colorPrimaries?: string; colorTransfer?: string;
  colorSpace?: string; colorRange?: string; dvProfile?: number; dvLevel?: number;
  dvBlSignalCompatibilityId?: number; rpuPresent?: boolean; elPresent?: boolean; blPresent?: boolean;
}
export interface OriginalAudio { id: string; label?:string; codec: string; channels?: number; sampleRate?: number; language?: string; channelMask?: number | null; nativeSupported?: boolean; streamIndex: number }
export interface OriginalMedia {
  url: string; container: string; duration: number | null; position: number; audioTrackCount?: number; discrepancies?: string[];
  video: OriginalVideo; audio: OriginalAudio[]; selectedAudioId: string | null;
}
const flag = (value: boolean | undefined) => value === undefined ? null : Number(value);
/** Adapt Vela's named source facts to the MIT engine's internal metadata schema.
 * Keep this compatibility DTO private: it is not a second wire protocol. */
export function upstreamOptions(media: OriginalMedia) {
  const v = media.video;
  if (!v.codec || !Number.isSafeInteger(v.width) || v.width <= 0 || !Number.isSafeInteger(v.height) || v.height <= 0)
    throw new Error('Original video configuration is incomplete');
  const selected = media.audio.find(a => a.id === media.selectedAudioId) ?? media.audio[0];
  const audio = selected ? [selected] : [];
  const transfer = v.colorTransfer?.toLowerCase();
  const hdr = v.dvProfile !== undefined || transfer === 'smpte2084' || transfer === 'arib-std-b67';
  return {
    playMethod: 'DirectPlay', playerStartPositionTicks: Math.round(media.position * 10000000),
    source: { kind: 'url' as const, url: media.url },
    mediaSource: {
      Container: media.container, RunTimeTicks: media.duration === null ? null : Math.round(media.duration * 10000000),
      DefaultAudioStreamIndex: selected?.streamIndex ?? null,
      MediaStreams: [{ Type: 'Video', Codec: v.codec, Width: v.width, Height: v.height,
        IsInterlaced: v.isInterlaced ?? null, Rotation: v.rotation ?? null,
        BitDepth: v.bitDepth ?? null, Profile: v.profile ?? null, Level: v.level ?? null,
        AverageFrameRate: v.frameRate ?? null, RealFrameRate: v.frameRate ?? null,
        ColorPrimaries: v.colorPrimaries ?? null, ColorTransfer: v.colorTransfer ?? null,
        ColorSpace: v.colorSpace ?? null, ColorRange: v.colorRange ?? null,
        VideoRange: hdr ? 'HDR' : v.colorTransfer ? 'SDR' : null,
        VideoRangeType: v.dvProfile !== undefined ? `DOVI${v.dvProfile}` : transfer === 'smpte2084' ? 'HDR10' : transfer === 'arib-std-b67' ? 'HLG' : v.colorTransfer ? 'SDR' : null,
        DvProfile: v.dvProfile ?? null, DvLevel: v.dvLevel ?? null,
        DvBlSignalCompatibilityId: v.dvBlSignalCompatibilityId ?? null,
        RpuPresentFlag: flag(v.rpuPresent), ElPresentFlag: flag(v.elPresent), BlPresentFlag: flag(v.blPresent),
      }, ...audio.map(a => ({ Type: 'Audio', Index: a.streamIndex, Codec: a.codec, Channels: a.channels ?? null, SampleRate: a.sampleRate ?? null, ChannelLayout: a.channelMask === undefined || a.channelMask === null ? null : ({3:'stereo',4:'mono',63:'5.1',1551:'5.1(side)',1599:'7.1'} as Record<number,string>)[a.channelMask] ?? null }))],
    },
  };
}
