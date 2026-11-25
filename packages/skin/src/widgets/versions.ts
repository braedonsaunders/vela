import { msg, type VersionItem } from '@vela/core';

export function versionBadge(version: VersionItem): string {
  return version.remembered ? 'Your choice' : version.pinned ? 'Pinned by owner' : version.recommended ? 'Recommended' : '';
}

const ranges: Record<string, string> = { sdr: 'SDR', hdr10: 'HDR10', 'hdr10+': 'HDR10+', hlg: 'HLG', dv: 'Dolby Vision' };
const codecs: Record<string, string> = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', aac: 'AAC', ac3: 'Dolby Digital', eac3: 'Dolby Digital+', truehd: 'TrueHD', dts: 'DTS' };

function codec(value: string | undefined): string {
  if (!value) return '';
  const key = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return codecs[key] ?? value.toUpperCase();
}

function sizeChip(bytes: number | undefined): string {
  return bytes && bytes > 0 ? `${(bytes / 1_000_000_000).toFixed(bytes >= 10_000_000_000 ? 0 : 1)} GB` : '';
}

export function versionChips(version: VersionItem): string[] {
  const audio = version.audio;
  return [
    version.resolution ?? '', ranges[version.dynamicRange ?? ''] ?? '', codec(version.videoCodec),
    audio?.atmos ? 'Dolby Atmos' : '', codec(audio?.codec), audio?.channels ?? '',
    version.source ?? '', version.edition ?? '', ...(version.languages ?? []), sizeChip(version.sizeBytes),
  ].filter((value, index, all): value is string => !!value && all.indexOf(value) === index);
}

/** The smaller fact set that stays legible inside the player's compact quality menu. */
export function versionMenuChips(version: VersionItem): string[] {
  const range = ranges[version.dynamicRange ?? ''] ?? '';
  return [
    versionBadge(version),
    version.resolution ?? '',
    range,
    version.audio?.atmos ? 'Dolby Atmos' : '',
    sizeChip(version.sizeBytes),
  ].filter((value, index, values): value is string => !!value && values.indexOf(value) === index);
}

export function versionAvailability(version: VersionItem): string {
  if (version.availability === 'fetch') return 'May take a moment to prepare';
  if (version.availability === 'unavailable') return version.note || 'Unavailable';
  return version.availability === 'cached' ? 'Ready · cached' : 'Ready';
}

export function preparingRetry(code: string | undefined, retry: { afterSeconds?: number; maxAttempts?: number } | undefined, attempt: number): number | null {
  if (code !== 'version_preparing' || attempt >= Math.min(3, retry?.maxAttempts ?? 3)) return null;
  return Math.max(1, retry?.afterSeconds ?? 1);
}

export function versionMenuGroups<T>(versions: VersionItem[] | undefined, converted: T[]) {
  return { versions: versions ?? [], converted };
}

/** The play action's argument that starts `version` of a title: its id exactly as the server gave
 * it, Auto included. An empty id would let the server's remembered choice decide instead, so
 * choosing Auto started whatever was remembered. */
export function versionPlayArg(titleId: string, version: VersionItem): string {
  return `${titleId}||||${version.id}`;
}

/** The listed version the server says is playing (Auto when it names Auto's id), if any. */
export function selectedVersion(versions: VersionItem[] | undefined, selectedVersionId: string | undefined): VersionItem | undefined {
  return selectedVersionId ? versions?.find(version => version.id === selectedVersionId) : undefined;
}

/** The release the player's converted qualities come from, by name: the release the server says
 * is playing where it says (Auto's pick included), else the chosen release; '' for the current
 * version (Auto, which is the first row and picks a release itself, or no named choice). */
export function convertedFrom(versions: VersionItem[] | undefined, selectedVersionId: string | undefined, playingLabel = ''): string {
  if (playingLabel.trim()) return playingLabel.split(' · ')[0]!.trim();
  const selected = selectedVersion(versions, selectedVersionId);
  return selected && selected.id !== versions?.[0]?.id ? selected.label.split(' · ')[0]! : '';
}

/** A version row's status line: "Playing now" on the release the server says is playing (which
 * under Auto is another row than the one chosen), then the row's availability. */
export function versionRowStatus(version: VersionItem, playingVersionId: string | null | undefined): string {
  const availability = versionAvailability(version);
  return version.id === playingVersionId ? `${msg('player.version.playing')} · ${availability}` : availability;
}

/** The release playing when no row of the menu is it (Auto resolving to a release it does not
 * list), for a line under the rows: '' when a row is it or the server does not say. */
export function playingElsewhere(versions: VersionItem[] | undefined, playingVersionId: string | null | undefined, playingLabel: string): string {
  if (!playingLabel || playingVersionId === undefined) return '';
  if (playingVersionId !== null && versions?.some(version => version.id === playingVersionId)) return '';
  return msg('player.version.playingRelease', { release: playingLabel });
}
