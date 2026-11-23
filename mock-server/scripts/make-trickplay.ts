// Scrub thumbnail sheets for the synthetic fixture: one 320x180 still per second, each showing its
// own second as a counter (so a scrub preview proves which cell was drawn), ten by ten per JPEG.
// Additive: writes only trickplay/320/ under the media root and refuses to overwrite it.
import { mkdir } from 'node:fs/promises';
import { fixtureDurationSeconds, mediaRoot } from '../media';
import { trickplayDir } from '../trickplay';
if (await Bun.file(`${trickplayDir}/0.jpg`).exists()) throw new Error(`Existing ${trickplayDir}; refusing to overwrite trickplay sheets.`);
await mkdir(trickplayDir, { recursive: true });
const ff = Bun.spawn(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=1:duration=${fixtureDurationSeconds}`,
  '-vf', 'tile=10x10', '-q:v', '5', '-start_number', '0', `${trickplayDir}/%d.jpg`], { stdout: 'inherit', stderr: 'inherit' });
if (await ff.exited) throw new Error('ffmpeg failed');
console.log(`Trickplay sheets ready: ${trickplayDir} (media root ${mediaRoot})`);
