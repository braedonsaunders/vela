/** Opt-in original-file fixture. Never replaces existing media. */
import { link, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
const root = join(homedir(), '.scratch/tmp/vela/media');
const target = join(root, 'universal-avc.mp4');
await mkdir(root, { recursive: true });
if (await Bun.file(target).exists()) { console.log(`Keeping ${target}`); process.exit(0); }
const work = await mkdtemp(join(root, '.universal-avc-'));
try {
  const output = join(work, 'fixture.mp4');
  const encode = Bun.spawn(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-n',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=8',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8',
    '-map', '0:v:0', '-map', '1:a:0', '-vf', 'setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-profile:v', 'high', '-level:v', '3.1', '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k', '-t', '8', '-movflags', '+faststart', output],
    { stdout: 'inherit', stderr: 'inherit' });
  if (await encode.exited) throw new Error('AVC fixture encoding failed');
  const probe = Bun.spawn(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { stdout: 'pipe', stderr: 'inherit' });
  const metadata = await new Response(probe.stdout).json();
  if (await probe.exited) throw new Error('AVC fixture probe failed');
  const video = metadata.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
  const audio = metadata.streams.find((s: { codec_type: string }) => s.codec_type === 'audio');
  if (video?.codec_name !== 'h264' || video.profile !== 'High' || video.width !== 640 || video.height !== 360 || video.r_frame_rate !== '24/1'
    || video.color_primaries !== 'bt709' || video.color_transfer !== 'bt709' || video.color_space !== 'bt709' || video.color_range !== 'tv'
    || audio?.codec_name !== 'aac' || audio.sample_rate !== '48000' || audio.channels !== 2 || Math.abs(Number(metadata.format.duration) - 8) > .1) {
    throw new Error('Encoded fixture does not match the requested AVC/AAC/BT.709 format');
  }
  // Exclusive publication: concurrent generators cannot overwrite an existing fixture.
  try { await link(output, target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  console.log(target);
} finally { await rm(work, { recursive: true, force: true }); }
