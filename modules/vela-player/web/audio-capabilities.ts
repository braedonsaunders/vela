// What the page's audio engine plays (apps/vela/src/media/audio-engine.web.ts), for music, audiobook
// and podcast requests. That engine is the same in a browser and in every desktop shell: the gapless
// player (WebCodecs through Mediabunny) and, for anything it cannot open, an <audio> element. So an
// audio request declares their union, never the desktop's native video host's list: a FLAC album
// declared as AAC-only is transcoded live by the server instead of played losslessly.
import type { PlayerCapabilities } from '@vela/player-api';

/** One audio codec: the <audio> element's MIME probe, and the containers it arrives in. */
interface AudioFormat { codec: string; mime: string; containers: string[] }

/** Ether infers audio-only containers from the codecs (modules/vela-player/src/audio.ts); both are declared. */
export const AUDIO_ENGINE_FORMATS: AudioFormat[] = [
  { codec: 'flac', mime: 'audio/flac', containers: ['flac'] },
  { codec: 'alac', mime: 'audio/mp4; codecs="alac"', containers: ['mp4', 'm4a', 'm4b'] },
  { codec: 'pcm', mime: 'audio/wav; codecs="1"', containers: ['wav'] },
  { codec: 'aac', mime: 'audio/mp4; codecs="mp4a.40.2"', containers: ['mp4', 'm4a', 'm4b', 'aac'] },
  { codec: 'mp3', mime: 'audio/mpeg', containers: ['mp3'] },
  { codec: 'opus', mime: 'audio/ogg; codecs="opus"', containers: ['ogg', 'webm'] },
  { codec: 'vorbis', mime: 'audio/ogg; codecs="vorbis"', containers: ['ogg', 'webm'] },
  { codec: 'ac3', mime: 'audio/mp4; codecs="ac-3"', containers: ['mp4', 'm4a'] },
  { codec: 'eac3', mime: 'audio/mp4; codecs="ec-3"', containers: ['mp4', 'm4a'] },
];

/**
 * The declaration from what the two players said: `playable` is the <audio> element's answer for a
 * MIME type, `decodable` the codecs WebCodecs decodes for the gapless player. A codec either one plays
 * is declared, with its containers.
 */
export function audioEngineCapabilities(playable: (mime: string) => boolean, decodable: ReadonlySet<string>, hls: boolean): PlayerCapabilities {
  const formats = AUDIO_ENGINE_FORMATS.filter(format => decodable.has(format.codec) || playable(format.mime));
  return {
    containers: [...new Set(formats.flatMap(format => format.containers))],
    videoCodecs: [],
    audioCodecs: formats.map(format => format.codec),
    subtitleFormats: [],
    hls,
    mse: false,
  };
}

/** A FLAC STREAMINFO (44.1 kHz, stereo, 16-bit), the description WebCodecs asks a FLAC decoder for. */
function flacDescription(): Uint8Array {
  const bytes = new Uint8Array(42);
  bytes.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]); // "fLaC", last block, STREAMINFO, 34 bytes
  const info = new DataView(bytes.buffer, 8);
  info.setUint16(0, 4096); info.setUint16(2, 4096); // block sizes
  // 20-bit rate 44100, 3-bit channels-1 (1), 5-bit bits-1 (15), then 36-bit sample count (0).
  const packed = (44100 << 12) | (1 << 9) | (15 << 4);
  info.setUint32(10, packed >>> 0);
  return bytes;
}

const DECODER_PROBES: [string, () => AudioDecoderConfig][] = [
  ['flac', () => ({ codec: 'flac', sampleRate: 44100, numberOfChannels: 2, description: flacDescription() })],
  ['aac', () => ({ codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2 })],
  ['mp3', () => ({ codec: 'mp3', sampleRate: 44100, numberOfChannels: 2 })],
  ['opus', () => ({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 })],
  ['pcm', () => ({ codec: 'pcm-s16', sampleRate: 44100, numberOfChannels: 2 })],
];

async function webCodecsAudio(): Promise<Set<string>> {
  const decodable = new Set<string>();
  if (typeof AudioDecoder !== 'function') return decodable;
  await Promise.all(DECODER_PROBES.map(async ([codec, config]) => {
    try {
      if ((await AudioDecoder.isConfigSupported(config())).supported) decodable.add(codec);
    } catch { /* Not this codec. */ }
  }));
  return decodable;
}

let probed: Promise<PlayerCapabilities> | undefined;

/** The page's audio engine's capabilities, probed once (the same in a browser and a desktop shell). */
export function audioCapabilities(): Promise<PlayerCapabilities> {
  probed ??= (async () => {
    const element = document.createElement('audio');
    const playable = (mime: string) => element.canPlayType(mime) !== '';
    return audioEngineCapabilities(playable, await webCodecsAudio(), playable('application/vnd.apple.mpegurl'));
  })().catch(error => {
    probed = undefined;
    throw error;
  });
  return probed;
}
