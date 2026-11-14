/** Vela build-time modifications to pinned MIT WebGPU Player / MPL Mediabunny.
 * Apply through the bundler's onLoad; originals remain pristine. Fail closed on
 * an upstream change so codec-private metadata cannot silently be omitted. */
import { resolve } from 'node:path';
import codecs from './codecs.json';
const runtimeImport = resolve(import.meta.dir, 'track-configuration.ts');
function replaceOnce(source: string, before: string, after: string) {
  if (source.split(before).length !== 2) throw new Error(`Pinned audio hook anchor changed: ${before.slice(0, 80)}`);
  return source.replace(before, after);
}
export function transformUpstreamAudio(path: string, source: string): string | null {
  const name = path.replace(/\\/g, '/');
  if (name.endsWith('/pipeline/CustomDecode.worker.ts')) {
    source = `import { velaContainerCodec, velaTrackConfiguration } from ${JSON.stringify(runtimeImport)};\n` + source;
    source = replaceOnce(source,
      "getContainerAudioCodec(codec, internalCodecID) === null && waveFormatTrack === null)",
      "getContainerAudioCodec(codec, internalCodecID) === null && velaContainerCodec(internalCodecID) === null && waveFormatTrack === null)");
    // Only the Vela package declares this option; stock codec private data is untouched.
    const begin = source.indexOf('function preparePackageAudioTrack(');
    const end = source.indexOf('async function prepareMediabunnyDecodedAudioTrack(', begin);
    if (begin < 0 || end < 0) throw new Error('Pinned package preparation function changed');
    const body = source.slice(begin, end);
    const modified = replaceOnce(body, '        packageCodecPrivate,\n        routeCodec,',
      '        packageCodecPrivate: [...packageDecoder.source.manifest.options.values()].includes("velaConfiguration")\n' +
      '            ? velaTrackConfiguration(metadata, routeCodec) : packageCodecPrivate,\n        routeCodec,');
    return source.slice(0, begin) + modified + source.slice(end);
  }
  if (name.endsWith('/audio/CustomAudioCodec.ts')) {
    return replaceOnce(source, 'export const CUSTOM_PACKAGE_AUDIO_CODECS = [',
      "export const CUSTOM_PACKAGE_AUDIO_CODECS = [\n    'alac', 'mp1', 'mp2',");
  }
  if (name.endsWith('/capability/CustomPlaybackEligibility.ts')) {
    source = replaceOnce(source, 'const AUDIO_CODEC_ALIASES = new Map<string, CustomAudioCodec>([',
      "const AUDIO_CODEC_ALIASES = new Map<string, CustomAudioCodec>([\n    [ 'ALAC', 'alac' ], [ 'MP1', 'mp1' ], [ 'MP2', 'mp2' ],");
    source = replaceOnce(source, "if (capabilities.audio[codec].status === 'supported') {",
      "if (capabilities.audio[codec]?.status === 'supported') {");
    source = replaceOnce(source, "if (capabilities.audio[codec].status !== 'supported') {",
      "if (capabilities.audio[codec]?.status !== 'supported') {");
    source = replaceOnce(source,
      'const decoderPackage = audioDecoders.find((candidate: AudioDecoderPackage): boolean => candidate.manifest.codecs.includes(codec));',
      "const decoderPackage = audioDecoders.find((candidate: AudioDecoderPackage): boolean => candidate.manifest.codecs.includes(codec) || (candidate.id === 'vela-audio' && candidate.manifest.codecs.includes(codec.replaceAll('_', '-'))));");
    return replaceOnce(source, 'return { codec, source: { manifest: decoderPackage.manifest, memory: decoderPackage.memory, module: decoderPackage.module } };',
      "return { codec: decoderPackage.id === 'vela-audio' ? codec.replaceAll('_', '-') : codec, source: { manifest: decoderPackage.manifest, memory: decoderPackage.memory, module: decoderPackage.module } };");
  }
  if (name.endsWith('/capability/CustomContainerCodecSupport.ts')) {
    source = replaceOnce(source, 'const CUSTOM_ISO_BASE_MEDIA_AUDIO_CODECS: readonly CustomAudioCodec[] = Object.freeze([',
      "const CUSTOM_ISO_BASE_MEDIA_AUDIO_CODECS: readonly CustomAudioCodec[] = Object.freeze([\n    'alac',");
    return replaceOnce(source, 'const CUSTOM_MATROSKA_AUDIO_CODECS: readonly CustomAudioCodec[] = Object.freeze([',
      "const CUSTOM_MATROSKA_AUDIO_CODECS: readonly CustomAudioCodec[] = Object.freeze([\n    'alac', 'mp1', 'mp2',");
  }
  if (name.endsWith('/audio/CustomAudioOutputPolicy.ts')) {
    const marker = 'export function isSupportedCustomAudioInputLayout(';
    const at = source.indexOf(marker);
    if (at < 0) throw new Error('Pinned input policy changed');
    source = replaceOnce(source, 'export function getSupportedCustomAudioInputChannelCounts(codec: CustomAudioCodec): readonly number[] {',
      "export function getSupportedCustomAudioInputChannelCounts(codec: CustomAudioCodec): readonly number[] {\n    if (codec === 'alac' || codec === 'mp1' || codec === 'mp2') return [1, 2, 3, 5, 6, 7, 8];");
    const position = source.indexOf(marker);
    const before = source.slice(0, position), body = source.slice(position);
    return before + replaceOnce(body,
      "    if (isCustomMediabunnyPCMAudioCodec(codec) || isMediabunnyPCMDecoderCodec(codec)) {",
      `    if (${JSON.stringify(codecs.map(([codec]) => codec.replaceAll('_', '-')))}.includes(codec)) {\n` +
      '        return [1, 2, 3, 5, 6, 7, 8].includes(channelCount);\n    }\n\n' +
      '    if (isCustomMediabunnyPCMAudioCodec(codec) || isMediabunnyPCMDecoderCodec(codec)) {');
  }
  if (name.endsWith('/audio/processing/DecodedAudioOutputStage.ts')) {
    // Float PCM can legitimately exceed full scale even without a fold-down.
    // Keep one linked limiter across all decoded channels, including stereo.
    return replaceOnce(source, '            peakLimiterEnabled: false,', '            peakLimiterEnabled: true,');
  }
  if (name.endsWith('/isobmff/isobmff-demuxer.ts')) {
    // Preserve the ALAC full-box atom without claiming it is a WebCodecs codec.
    source = replaceOnce(source, "} else if (codecName === 'flac') {",
      "} else if (codecName === 'alac') {\n                            // Vela owns this codec through its separately loaded decoder package.\n                        } else if (codecName === 'flac') {");
    return replaceOnce(source, "\t\t\tcase 'dOps': { // Used for Opus audio",
      "\t\t\tcase 'alac': {\n" +
      "\t\t\t\tconst track = this.currentTrack;\n" +
      "\t\t\t\tif (!track || track.info?.type !== 'audio') break;\n" +
      "\t\t\t\tconst content = readBytes(slice, boxInfo.contentSize);\n" +
      "\t\t\t\tconst atom = new Uint8Array(8 + content.byteLength);\n" +
      "\t\t\t\tnew DataView(atom.buffer).setUint32(0, atom.byteLength, false);\n" +
      "\t\t\t\tatom.set([97,108,97,99], 4); atom.set(content, 8);\n" +
      "\t\t\t\ttrack.info.codecDescription = atom;\n" +
      "\t\t\t}; break;\n\n\t\t\tcase 'dOps': { // Used for Opus audio");
  }
  return null;
}
