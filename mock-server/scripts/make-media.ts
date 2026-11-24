import { mkdir } from 'node:fs/promises';
import { mediaRoot, fixtureDurationSeconds } from '../media';
import { mseDescriptor, mseLadder, mseAudioGroup } from '../mse';
const mseOnly = process.argv.includes('--mse-only');
const tsOnly = process.argv.includes('--ts-only');
if (mseOnly && tsOnly) throw new Error('Choose --mse-only or --ts-only');
await mkdir(mediaRoot, { recursive: true });
if (tsOnly) { await makeTs(); console.log(`TS media ready: ${mediaRoot}`); process.exit(0); }
if (await Bun.file(`${mediaRoot}/mse.json`).exists()) throw new Error('MSE fixture already generated; do not overwrite media while a player may be using it.');
for (const [height] of mseLadder) if (await Bun.file(`${mediaRoot}/video${height}/index.m3u8`).exists()) throw new Error(`Existing video${height} playlist; stop players before removing an incomplete MSE generation.`);
async function ff(args: string[]) {
  const p = Bun.spawn(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', ...args], { stdout: 'inherit', stderr: 'inherit' });
  if (await p.exited) throw new Error('ffmpeg failed');
}
async function makeTs() {
  for (const file of ['ts-master.m3u8', ...mseLadder.map(([h]) => `ts${h}/index.m3u8`)]) {
    if (await Bun.file(`${mediaRoot}/${file}`).exists()) throw new Error(`Existing ${file}; refusing to overwrite TS media.`);
  }
  for (const [height] of mseLadder) {
    const dir = `${mediaRoot}/ts${height}`;
    await mkdir(dir, { recursive: true });
    await ff(['-i', `${mediaRoot}/v${height}/index.m3u8`, '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_type', 'mpegts', '-hls_flags', 'independent_segments', '-hls_segment_filename', `${dir}/seg-%03d.ts`, `${dir}/index.m3u8`]);
  }
  await Bun.write(`${mediaRoot}/ts-master.m3u8`, '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-INDEPENDENT-SEGMENTS\n'
    + mseLadder.map(([height, width, bitrate]) => `#EXT-X-STREAM-INF:BANDWIDTH=${bitrate + 128000},RESOLUTION=${width}x${height},CODECS="avc1.64001f,mp4a.40.2"\nts${height}/index.m3u8\n`).join(''));
}
// Synthetic imagery and tones only. Fixed keyframes align all renditions at 4 seconds.
// VELA_MOCK_SILENT_MEDIA=1 makes both audio tracks silence, for players whose sound cannot be muted
// (a simulator plays through the Mac's speakers).
const tone = (frequency: number) => process.env.VELA_MOCK_SILENT_MEDIA === '1' ? 'anullsrc=channel_layout=stereo:sample_rate=48000' : `sine=frequency=${frequency}:sample_rate=48000`;
if (!mseOnly) {
await ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24', '-f', 'lavfi', '-i', tone(440), '-f', 'lavfi', '-i', tone(660), '-t', String(fixtureDurationSeconds), '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-level:v', '3.1', '-pix_fmt', 'yuv420p', '-b:v', '2200k', '-g', '96', '-keyint_min', '96', '-sc_threshold', '0', '-c:a', 'aac', '-ac', '2', '-b:a', '128k', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=spa', '-movflags', '+faststart', `${mediaRoot}/direct.mp4`]);
for (const [height, bitrate] of [[360, '500k'], [540, '1100k'], [720, '2200k']] as const) {
  const dir = `${mediaRoot}/v${height}`; await mkdir(dir, { recursive: true });
  await ff(['-i', `${mediaRoot}/direct.mp4`, '-map', '0:v:0', '-map', '0:a:0', ...(height === 720 ? ['-c:v', 'copy'] : ['-vf', `scale=-2:${height}`, '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-level:v', '3.1', '-b:v', bitrate, '-g', '96', '-keyint_min', '96', '-sc_threshold', '0']), '-c:a', 'copy', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4', '-hls_flags', 'independent_segments', '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', `${dir}/seg-%03d.m4s`, `${dir}/index.m3u8`]);
}
for (const [n, lang] of ['en', 'es'].entries()) {
  const dir = `${mediaRoot}/a_${lang}`; await mkdir(dir, { recursive: true });
  await ff(['-i', `${mediaRoot}/direct.mp4`, '-map', `0:a:${n}`, '-c:a', 'copy', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', `${dir}/seg-%03d.m4s`, `${dir}/index.m3u8`]);
}
await Bun.write(`${mediaRoot}/master.m3u8`, '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="a_en/index.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Spanish",LANGUAGE="es",DEFAULT=NO,AUTOSELECT=YES,URI="a_es/index.m3u8"\n' + [[360,640,700000],[540,960,1400000],[720,1280,2600000]].map(([h,w,b]) => `#EXT-X-STREAM-INF:BANDWIDTH=${b},RESOLUTION=${w}x${h},CODECS="avc1.64001f,mp4a.40.2",AUDIO="audio"\nv${h}/index.m3u8\n`).join(''));
await Bun.write(`${mediaRoot}/subtitles.vtt`, 'WEBVTT\n\n00:00:00.000 --> 00:00:08.000\nVela synthetic playback fixture.\n\n00:00:08.000 --> 00:00:20.000\nAligned four-second CMAF segments, three qualities.\n\n00:00:20.000 --> 00:00:40.000\nAudio tones identify the English and Spanish fixture tracks.\n\n00:00:40.000 --> 00:03:00.000\nAll media is generated locally.\n');
}
// Additive generation: reuse the encoded clock/keyframes without touching muxed
// renditions, the direct file, native master, subtitles or either audio track.
const descriptor = mseDescriptor();
for (const [height] of mseLadder) {
  const dir = `${mediaRoot}/video${height}`;
  await mkdir(dir, { recursive: true });
  await ff(['-copyts', '-i', `${mediaRoot}/v${height}/index.m3u8`, '-map', '0:v:0', '-c:v', 'copy', '-an', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4', '-hls_flags', 'independent_segments', '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', `${dir}/seg-%03d.m4s`, `${dir}/index.m3u8`]);
}
for (const audio of descriptor.audioRenditions) if (!await Bun.file(`${mediaRoot}/${audio.url}`).exists()) throw new Error(`Missing ${audio.url}; run full generation before --mse-only.`);
await Bun.write(`${mediaRoot}/${descriptor.url}`, '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-INDEPENDENT-SEGMENTS\n'
  + ['en', 'es'].map((language, n) => `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${mseAudioGroup}",NAME="${n ? 'Spanish' : 'English'}",LANGUAGE="${language}",DEFAULT=${n ? 'NO' : 'YES'},AUTOSELECT=YES,URI="a_${language}/index.m3u8"\n`).join('')
  + mseLadder.map(([height, width, bitrate]) => `#EXT-X-STREAM-INF:BANDWIDTH=${bitrate + 128000},RESOLUTION=${width}x${height},CODECS="avc1.64001f,mp4a.40.2",AUDIO="${mseAudioGroup}"\nvideo${height}/index.m3u8\n`).join(''));
await Bun.write(`${mediaRoot}/mse.json`, JSON.stringify(descriptor, null, 2) + '\n');
if (!mseOnly) await makeTs();
console.log(`Media ready: ${mediaRoot}`);
