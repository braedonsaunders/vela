import type { SubtitleDescription, SubtitleTrack, SubtitleCodec } from './types';
export function subtitleIdentity(
  container: 'mkv' | 'mp4',
  containerTrackId: number,
  streamIndex: number,
  codec: SubtitleCodec,
  language: string,
  label: string,
  defaultTrack: boolean,
  forced: boolean,
  descriptions: readonly SubtitleDescription[],
): SubtitleTrack {
  const matches = descriptions.filter((track) => track.streamIndex === streamIndex);
  const serverId =
    matches.length === 1 && descriptions.filter((track) => track.id === matches[0].id).length === 1
      ? matches[0].id
      : undefined;
  return {
    id: serverId ?? `${container}:${containerTrackId}`,
    serverId,
    streamIndex,
    containerTrackId,
    codec,
    language: language.slice(0, 64) || 'und',
    label: [label, language, forced ? 'Forced' : '', codec.toUpperCase()]
      .filter(Boolean)
      .join(' ')
      .slice(0, 512),
    default: defaultTrack,
    forced,
    delivery: { kind: 'embedded' },
  };
}
