// Source → output facts for the player's info card, emitted by every engine as Snapshot.format.
// Each field is what the engine or the OS actually reported; an unknown stays absent, never guessed.

/** Dynamic range by name. 'hdr10+' is HDR10 whose ST 2094-40 metadata the engine saw in the stream. */
export type RangeFormat = 'sdr' | 'hdr10' | 'hdr10+' | 'hlg' | 'dv';

/** How a display-matching preference resolved: the panel switched to the content ('matched'), stayed
 * on another mode although matching is on ('unmatched'), matching is off in the system or app
 * settings ('off'), or the platform cannot switch modes ('unsupported'). */
export type MatchState = 'matched' | 'unmatched' | 'off' | 'unsupported';

/** Immersive audio by family: Dolby Atmos (E-AC-3 JOC or TrueHD) or DTS:X. */
export type ImmersiveFormat = 'atmos' | 'dtsx';

export interface VideoSourceFormat {
  /** FFmpeg codec name: 'hevc', 'h264', 'av1', 'vp9', 'vc1', 'mpeg2video'. */
  codec: string;
  /** Codec profile as named by the decoder ('Main 10', 'High'). */
  profile?: string;
  bitDepth?: number;
  width?: number;
  height?: number;
  /** Frames per second, exact (23.976 is 24000/1001 = 23.976023…). */
  frameRate?: number;
  range?: RangeFormat;
  /** Dolby Vision profile of the source ('5', '7', '8.1', '8.4', '10.1'). */
  dvProfile?: string;
  dvLevel?: number;
  /** Dolby Vision enhancement layer of a Profile 7 source. */
  dvLayer?: 'fel' | 'mel';
  interlaced?: boolean;
}

export interface VideoOutputFormat {
  /** What the display is sent. */
  range?: RangeFormat;
  dvProfile?: string;
  /**
   * What the client did to Dolby Vision on the way: a Profile 7 RPU converted to 8.1 ('p7-to-8.1'),
   * the same with the FEL enhancement layer folded into the 8.1 curves ('p7-fel-folded'), or the
   * HDR10/HLG base layer shown without Dolby Vision ('base-layer').
   */
  dvConversion?: 'p7-to-8.1' | 'p7-fel-folded' | 'base-layer';
  decoder?: 'hardware' | 'software';
  /** Decoder or route name for experts ('VideoToolbox', 'dav1d', 'd3d11va'). */
  decoderName?: string;
  /** The display mode, where the platform reports it. */
  width?: number;
  height?: number;
  refreshRate?: number;
  frameRateMatch?: MatchState;
  rangeMatch?: MatchState;
  /** HDR mapped down for a display that cannot show it. */
  toneMapped?: boolean;
  deinterlaced?: boolean;
}

export interface AudioSourceFormat {
  /** FFmpeg codec name: 'truehd', 'eac3', 'dts', 'flac', 'aac'. */
  codec: string;
  /** Codec profile ('DTS-HD MA', 'Dolby TrueHD + Atmos', 'E-AC-3 + JOC'). */
  profile?: string;
  channels?: number;
  /** Channel layout name ('7.1', '5.1(side)', '7.1.4'). */
  layout?: string;
  sampleRate?: number;
  bitDepth?: number;
  immersive?: ImmersiveFormat;
  language?: string;
}

export interface AudioOutputFormat {
  /**
   * passthrough: the source bitstream reaches the receiver unchanged.
   * decoded: decoded to PCM (lossless for lossless sources), channel presentation only.
   * rendered: immersive objects/heights rendered into a speaker bed with heights.
   * transcoded: re-encoded to a lossy codec on the device (for example E-AC-3 for an ARC soundbar).
   * system: the OS player owns the audio and does not say how.
   */
  delivery: 'passthrough' | 'decoded' | 'rendered' | 'transcoded' | 'system';
  /** What leaves the app: the passthrough or re-encode codec, 'pcm', or 'apac'. */
  codec?: string;
  channels?: number;
  layout?: string;
  sampleRate?: number;
  bitDepth?: number;
  /** Whether no information was lost between source and output samples. */
  lossless?: boolean;
  /** Immersive audio the output carries to the receiver. */
  immersive?: ImmersiveFormat;
  /** How it travels on the link, only where the OS says so: Dolby MAT 2.0, an IEC 61937 bitstream, or
   * plain LPCM. Absent is unknown: an Android HAL may wrap a TrueHD bitstream in MAT without telling the app. */
  carrier?: 'mat' | 'iec61937' | 'lpcm';
  /** The decoder for experts ('FFmpeg truehd', 'WASM dca', 'AudioToolbox'). */
  decoderName?: string;
  /** Fewer channels than the source, or another rate, by the client's choice or the route's limit. */
  downmixed?: boolean;
  resampled?: boolean;
  /** Exclusive device access (WASAPI exclusive, CoreAudio hog mode). */
  exclusive?: boolean;
  /** Output kind: 'hdmi', 'hdmi-arc', 'hdmi-earc', 'airplay', 'bluetooth', 'speaker', 'headphones', 'usb', 'spdif', 'other'. */
  route?: string;
  /** Live object/height activity where the renderer reports it. */
  objectsActive?: number;
}

export interface PlaybackFormat {
  video: VideoSourceFormat | null;
  videoOut: VideoOutputFormat | null;
  audio: AudioSourceFormat | null;
  audioOut: AudioOutputFormat | null;
}
