/** Opt-in original-file format matrix for decoder and output qualification (README, "Format matrix").
 *
 *   bun mock-server/scripts/make-format-matrix.ts [output directory] [--only=<name,…>]
 *
 * Needs ffmpeg with libx265, libsvtav1 and libvpx-vp9, and dovi_tool (DOVI_TOOL=<path> when it is not
 * on PATH) for the Dolby Vision fixtures. Every fixture is 30 seconds of moving test pattern at
 * 1280×720, 24000/1001 fps. Multichannel audio plays a different tone on every channel (CHANNEL_TONES)
 * so a channel-map probe can name each output channel by its frequency. Existing files are kept. */
import { link, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Hz per channel; FFmpeg channel names. LFE sits below 120 Hz as an LFE channel should. */
export const CHANNEL_TONES: Record<string, number> = {
  FL: 400, FR: 500, FC: 630, LFE: 50, BL: 800, BR: 1000, SL: 1250, SR: 1600,
  TFL: 2000, TFR: 2500, TBL: 3150, TBR: 4000,
};
const LAYOUTS: Record<string, string[]> = {
  stereo: ['FL', 'FR'],
  '5.1(side)': ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR'],
  '5.1': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR'],
  '7.1': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR'],
};
const SECONDS = 30;
const SIZE = '1280x720';
const RATE = '24000/1001';
const MASTERING = 'G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)';
const PQ = ['-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-color_range', 'tv'];
const HLG = ['-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc', '-color_range', 'tv'];
const x265 = (extra: string) =>
  `repeat-headers=1:keyint=48:min-keyint=48:scenecut=0:vbv-bufsize=20000:vbv-maxrate=10000${extra ? ':' + extra : ''}`;
const hdr10 = `hdr10=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=${MASTERING}:max-cll=1000,400`;
const hlg = 'colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:atc-sei=18:pic_struct=0';

type Audio = { codec: string[]; layout: string; rate: number; sampleFormat?: string };
interface Fixture {
  name: string;
  video: string[];
  /** Pixel format before encode. */
  format: string;
  /** Dolby Vision: profile, and the HEVC base it rides on. */
  dv?: '8.1' | '8.4' | '5';
  audio: Audio;
  seconds?: number;
  size?: string;
  rate?: string;
}

const aac: Audio = { codec: ['-c:a', 'aac', '-b:a', '192k'], layout: 'stereo', rate: 48000 };
const fixtures: Fixture[] = [
  { name: 'h264-aac.mp4', format: 'yuv420p', video: ['-c:v', 'libx264', '-profile:v', 'high', '-preset', 'fast', '-crf', '22', '-g', '48', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'], audio: aac },
  { name: 'hevc-hdr10-eac3-5.1.mkv', format: 'yuv420p10le', video: ['-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', x265(hdr10), ...PQ], audio: { codec: ['-c:a', 'eac3', '-b:a', '640k'], layout: '5.1(side)', rate: 48000 } },
  { name: 'hevc-hlg-ac3-5.1.mp4', format: 'yuv420p10le', video: ['-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1', '-x265-params', x265(hlg), ...HLG], audio: { codec: ['-c:a', 'ac3', '-b:a', '448k'], layout: '5.1(side)', rate: 48000 } },
  { name: 'hevc-dv81-truehd-5.1.mkv', dv: '8.1', format: 'yuv420p10le', video: ['-c:v', 'libx265', '-preset', 'ultrafast', '-dolbyvision', '1', '-x265-params', x265(`${hdr10}:dolby-vision-profile=8.1`), ...PQ], audio: { codec: ['-c:a', 'truehd'], layout: '5.1(side)', rate: 48000, sampleFormat: 's32p' } },
  { name: 'hevc-dv81-ac3.mp4', dv: '8.1', format: 'yuv420p10le', video: ['-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'dvh1', '-dolbyvision', '1', '-x265-params', x265(`${hdr10}:dolby-vision-profile=8.1`), ...PQ], audio: { codec: ['-c:a', 'ac3', '-b:a', '448k'], layout: '5.1(side)', rate: 48000 } },
  { name: 'hevc-dv84-aac.mkv', dv: '8.4', format: 'yuv420p10le', video: ['-c:v', 'libx265', '-preset', 'ultrafast', '-dolbyvision', '1', '-x265-params', x265(`${hlg}:dolby-vision-profile=8.4`), ...HLG], audio: aac },
  // Profile 5's base is IPT-PQ-c2 with no HDR10 or SDR fallback; this pattern only proves signalling.
  { name: 'hevc-dv5-aac.mkv', dv: '5', format: 'yuv420p10le', video: ['-c:v', 'libx265', '-preset', 'ultrafast', '-dolbyvision', '1', '-x265-params', x265('colorprim=2:transfer=2:colormatrix=2:dolby-vision-profile=5')], audio: aac },
  { name: 'av1-hdr10-opus-5.1.mkv', format: 'yuv420p10le', video: ['-c:v', 'libsvtav1', '-preset', '10', '-crf', '35', '-g', '48', '-svtav1-params', 'mastering-display=G(0.265,0.69)B(0.15,0.06)R(0.68,0.32)WP(0.3127,0.329)L(1000,0.0001):content-light=1000,400', ...PQ], audio: { codec: ['-c:a', 'libopus', '-b:a', '384k', '-mapping_family', '1'], layout: '5.1', rate: 48000 } },
  { name: 'av1-sdr-aac.mp4', format: 'yuv420p', video: ['-c:v', 'libsvtav1', '-preset', '10', '-crf', '35', '-g', '48', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'], audio: aac },
  { name: 'vp9-p0-vorbis.webm', format: 'yuv420p', video: ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '3M', '-g', '48', '-row-mt', '1'], audio: { codec: ['-c:a', 'vorbis', '-q:a', '5'], layout: 'stereo', rate: 48000 } },
  { name: 'vp9-p2-hdr10-opus.webm', format: 'yuv420p10le', video: ['-c:v', 'libvpx-vp9', '-profile:v', '2', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '4M', '-g', '48', '-row-mt', '1', ...PQ], audio: { codec: ['-c:a', 'libopus', '-b:a', '160k'], layout: 'stereo', rate: 48000 } },
  { name: 'mpeg2-ac3.mkv', format: 'yuv420p', video: ['-c:v', 'mpeg2video', '-b:v', '8M', '-g', '12'], audio: { codec: ['-c:a', 'ac3', '-b:a', '384k'], layout: '5.1(side)', rate: 48000 } },
  // DVD-like NTSC: 720×480 at 30000/1001, interlaced top field first, no colour description.
  { name: 'mpeg2-480i-ac3.mkv', size: '720x480', rate: '30000/1001', format: 'yuv420p', video: ['-c:v', 'mpeg2video', '-b:v', '6M', '-g', '15', '-flags', '+ilme+ildct', '-field_order', 'tt'], audio: { codec: ['-c:a', 'ac3', '-b:a', '448k'], layout: '5.1(side)', rate: 48000 } },
  // Matroska keeps MS-MPEG4 v3 (DivX 3) in a VfW BITMAPINFOHEADER (V_MS/VFW/FOURCC).
  { name: 'msmpeg4v3-mp3.mkv', size: '640x360', format: 'yuv420p', video: ['-c:v', 'msmpeg4', '-q:v', '4', '-g', '48'], audio: { codec: ['-c:a', 'libmp3lame', '-b:a', '128k'], layout: 'stereo', rate: 48000 } },
  { name: 'mpeg4-mp3.mkv', format: 'yuv420p', video: ['-c:v', 'mpeg4', '-q:v', '4', '-g', '48'], audio: { codec: ['-c:a', 'libmp3lame', '-b:a', '192k'], layout: 'stereo', rate: 48000 } },
  { name: 'h264-flac-7.1-s24-96k.mkv', format: 'yuv420p', video: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', '48'], audio: { codec: ['-c:a', 'flac'], layout: '7.1', rate: 96000, sampleFormat: 's32' } },
  { name: 'h264-flac-2.0-s24-192k.mkv', format: 'yuv420p', video: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', '48'], audio: { codec: ['-c:a', 'flac'], layout: 'stereo', rate: 192000, sampleFormat: 's32' } },
  { name: 'h264-alac-2.0-s24-96k.mp4', format: 'yuv420p', video: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', '48'], audio: { codec: ['-c:a', 'alac'], layout: 'stereo', rate: 96000, sampleFormat: 's32p' } },
  { name: 'h264-dts-5.1.mkv', format: 'yuv420p', video: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', '48'], audio: { codec: ['-c:a', 'dca', '-strict', 'experimental', '-b:a', '1509k'], layout: '5.1(side)', rate: 48000 } },
  { name: 'h264-eac3-5.1.mkv', format: 'yuv420p', video: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', '48'], audio: { codec: ['-c:a', 'eac3', '-b:a', '640k'], layout: '5.1(side)', rate: 48000 } },
  { name: 'h264-opus-7.1.mkv', format: 'yuv420p', video: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', '48'], audio: { codec: ['-c:a', 'libopus', '-b:a', '512k', '-mapping_family', '1'], layout: '7.1', rate: 48000 } },
  { name: 'h264-pcm-7.1-s24.mov', format: 'yuv420p', video: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', '48'], audio: { codec: ['-c:a', 'pcm_s24le'], layout: '7.1', rate: 48000 } },
  { name: 'hevc-4k-hdr10-aac.mkv', seconds: 15, size: '3840x2160', format: 'yuv420p10le', video: ['-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', x265(hdr10), ...PQ], audio: aac },
];

/** The lavfi graph for a tone per channel, joined into the named layout. */
export function toneGraph(layout: string, rate: number, seconds: number): string {
  const channels = LAYOUTS[layout];
  if (!channels) throw new Error(`No tone layout ${layout}`);
  const sources = channels.map((name, n) => `sine=frequency=${CHANNEL_TONES[name]}:sample_rate=${rate}:duration=${seconds},volume=0.25[c${n}]`);
  const map = channels.map((name, n) => `${n}.0-${name}`).join('|');
  return `${sources.join(';')};${channels.map((_, n) => `[c${n}]`).join('')}join=inputs=${channels.length}:channel_layout=${layout}:map=${map}[a]`;
}

/** Tag the frames themselves: encoders take colour from frame properties over output options. */
function colour(video: string[]): string {
  const transfer = video[video.indexOf('-color_trc') + 1];
  if (!video.includes('-color_trc')) return '';
  const primaries = transfer === 'bt709' ? 'bt709' : 'bt2020';
  return `,setparams=range=tv:color_primaries=${primaries}:color_trc=${transfer}:colorspace=${primaries === 'bt709' ? 'bt709' : 'bt2020nc'}`;
}

async function run(command: string[], label: string) {
  const process = Bun.spawn(command, { stdout: 'ignore', stderr: 'pipe' });
  const errors = await new Response(process.stderr).text();
  if (await process.exited) throw new Error(`${label} failed:\n${errors.slice(-2000)}`);
}

async function make(root: string, fixture: Fixture, doviTool: string) {
  const target = join(root, fixture.name);
  if (await Bun.file(target).exists()) return console.log(`Keeping ${target}`);
  const work = await mkdtemp(join(root, '.format-'));
  try {
    const seconds = fixture.seconds ?? SECONDS;
    const pattern = `testsrc2=size=${fixture.size ?? SIZE}:rate=${fixture.rate ?? RATE}:duration=${seconds}`;
    const audio = ['-filter_complex', toneGraph(fixture.audio.layout, fixture.audio.rate, seconds)];
    let video = ['-f', 'lavfi', '-i', pattern];
    if (fixture.dv) {
      // Encode the base, inject a generated RPU, then let libx265 re-emit it with the DOVI record.
      const base = join(work, 'base.hevc');
      const params = fixture.dv === '8.4' ? x265(hlg) : fixture.dv === '5' ? x265('') : x265(hdr10);
      await run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', pattern, '-vf', `format=${fixture.format}`,
        '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', params, base], 'base encode');
      const frames = Math.round((seconds * 24000) / 1001) + 1;
      const config = join(work, 'rpu.json');
      await Bun.write(config, JSON.stringify({ cm_version: 'V40', profile: fixture.dv, length: frames + 8,
        level6: { max_display_mastering_luminance: 1000, min_display_mastering_luminance: 1, max_content_light_level: 1000, max_frame_average_light_level: 400 } }));
      await run([doviTool, 'generate', '-j', config, '-o', join(work, 'rpu.bin')], 'RPU generation');
      await run([doviTool, 'inject-rpu', '-i', base, '--rpu-in', join(work, 'rpu.bin'), '-o', join(work, 'dv.hevc')], 'RPU injection');
      video = ['-i', join(work, 'dv.hevc')];
    }
    const output = join(work, `out${fixture.name.slice(fixture.name.lastIndexOf('.'))}`);
    await run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', ...video, ...audio,
      '-map', '0:v:0', '-map', '[a]',
      '-vf', `format=${fixture.format}${colour(fixture.video)}${fixture.video.includes('+ilme+ildct') ? ',setfield=tff' : ''}`, ...fixture.video,
      ...fixture.audio.codec, '-ar', String(fixture.audio.rate), ...(fixture.audio.sampleFormat ? ['-sample_fmt', fixture.audio.sampleFormat] : []),
      '-t', String(seconds), '-strict', 'experimental', ...(output.endsWith('.mp4') || output.endsWith('.mov') ? ['-movflags', '+faststart'] : []), output], fixture.name);
    // Exclusive publication: a concurrent generator cannot overwrite an existing fixture.
    try { await link(output, target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    console.log(target);
  } finally { await rm(work, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const root = resolve(args.find((arg) => !arg.startsWith('--')) ?? join(homedir(), '.scratch/tmp/vela/formats'));
  const only = args.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
  await mkdir(root, { recursive: true });
  const doviTool = process.env.DOVI_TOOL ?? 'dovi_tool';
  let failed = 0;
  for (const fixture of fixtures.filter((f) => !only || only.includes(f.name)))
    await make(root, fixture, doviTool).catch((error) => {
      failed++;
      console.error(error instanceof Error ? error.message : error);
    });
  if (failed) process.exit(1);
}
