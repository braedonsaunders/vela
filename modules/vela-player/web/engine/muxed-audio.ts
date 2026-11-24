// The audio track a single muxed stream carries (one rendition with its audio inside, played by the
// browser's own media pipeline). The browser exposes no track list for it, so the plan says which
// it is: the track the plan selected, its only track, or its default. Without one of those it is
// unknown, and nothing is reported rather than a guess.

export interface PlanAudioTrack {
  id: string;
  default?: boolean;
}

export function muxedAudioTrack(tracks: readonly PlanAudioTrack[], selected: string | null | undefined): string | null {
  if (selected && tracks.some((t) => t.id === selected)) return selected;
  if (tracks.length === 1) return tracks[0]!.id;
  const defaults = tracks.filter((t) => t.default);
  return defaults.length === 1 ? defaults[0]!.id : null;
}
