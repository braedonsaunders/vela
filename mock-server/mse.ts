import { mediaRoot, fixtureDurationSeconds } from './media';

export const mseLadder = [[360, 640, 500000], [540, 960, 1100000], [720, 1280, 2200000]] as const;
export const mseAudioGroup = 'fixture-audio';
export function mseDescriptor() {
  return {
    durationSeconds: fixtureDurationSeconds,
    url: 'mse-master.m3u8',
    qualities: mseLadder.map(([height, width, bitrate]) => ({ id: `${height}p`, width, height, bitrate,
      videoCodec: 'avc1.64001f', audioGroupId: mseAudioGroup, url: `video${height}/index.m3u8` })),
    audioRenditions: ['en', 'es'].map(language => ({ trackId: `audio-${language}`, groupId: mseAudioGroup,
      url: `a_${language}/index.m3u8`, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000 })),
  };
}

export async function mseFixture(base: string) {
  const marker = Bun.file(`${mediaRoot}/mse.json`);
  if (!await marker.exists()) return undefined;
  const expected = mseDescriptor();
  // The marker is written last; do not advertise a stale or incomplete generation.
  try { if (JSON.stringify(await marker.json()) !== JSON.stringify(expected)) return undefined; }
  catch { return undefined; }
  const resources = [expected.url, ...expected.qualities.map(q => q.url), ...expected.audioRenditions.map(a => a.url)];
  if (!(await Promise.all(resources.map(r => Bun.file(`${mediaRoot}/${r}`).exists()))).every(Boolean)) return undefined;
  return { qualities: expected.qualities.map(q => ({ ...q, url: `${base}/${q.url}` })),
    audioRenditions: expected.audioRenditions.map(a => ({ ...a, url: `${base}/${a.url}` })), url: `${base}/${expected.url}` };
}
