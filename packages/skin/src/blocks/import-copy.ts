// What the playlist import form says, from what the server's import reads (features.playlistImport):
// only the link sources and file formats it lists are named, offered or suggested.
import { localeContext, msg, number, type PlaylistImportFormat, type PlaylistImportSources } from '@vela/core';

/** Display names for the link sources Vela knows; any other source shows its own id, capitalised. */
const SOURCE_NAMES: Record<string, string> = { deezer: 'Deezer', spotify: 'Spotify', tidal: 'TIDAL', youtube: 'YouTube Music', apple: 'Apple Music' };
/** An example link shape per known source, for the link field's placeholder. */
const SOURCE_EXAMPLES: Record<string, string> = { deezer: 'https://www.deezer.com/playlist/…', spotify: 'https://open.spotify.com/playlist/…' };
/** A public playlist per known source for the "Try a sample link" chips. */
export const SAMPLE_LINKS: Record<string, string> = {
  spotify: 'https://open.spotify.com/playlist/37i9dQZF1DX4JAvHpjipBk',
  deezer: 'https://www.deezer.com/playlist/908622995',
};

export function importSourceName(source: string): string {
  return SOURCE_NAMES[source] ?? (source ? source[0]!.toUpperCase() + source.slice(1) : source);
}

export function importFormatName(format: PlaylistImportFormat): string {
  return format.toUpperCase();
}

/** "Deezer", "Deezer or Spotify", "Deezer, Spotify or TIDAL" in the current locale. */
export function importOrList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  const ListFormat = (Intl as { ListFormat?: new (locale: string, options: { type: 'disjunction' }) => { format(list: readonly string[]): string } }).ListFormat;
  if (ListFormat) {
    try {
      return new ListFormat(localeContext().formatLocale, { type: 'disjunction' }).format(items);
    } catch {
      // An unknown locale falls through to the catalogue's own wording.
    }
  }
  return msg('music.import.or', { first: items.slice(0, -1).join(', '), last: items[items.length - 1]! });
}

const sourceList = (sources: PlaylistImportSources) => importOrList(sources.links.map(importSourceName));
const formatList = (sources: PlaylistImportSources) => importOrList(sources.files.map(importFormatName));

/** The page's one-line description of what can be imported, with the track limit when there is one. */
export function importSubtitle(sources: PlaylistImportSources | null): string {
  if (!sources || (!sources.links.length && !sources.files.length)) return msg('music.import.subtitle.none');
  const lead = sources.links.length && sources.files.length
    ? msg('music.import.subtitle.linksAndFiles', { sources: sourceList(sources), formats: formatList(sources) })
    : sources.links.length
      ? msg('music.import.subtitle.links', { sources: sourceList(sources) })
      : msg('music.import.subtitle.files', { formats: formatList(sources) });
  return sources.maxTracks > 0 ? `${lead} ${msg('music.import.maxTracks', { count: number(sources.maxTracks) })}` : lead;
}

/** The link field's placeholder: example links for the listed sources Vela knows, else their names. */
export function importUrlPlaceholder(sources: PlaylistImportSources): string {
  const examples = sources.links.map(source => SOURCE_EXAMPLES[source]).filter((example): example is string => !!example);
  return examples.length === sources.links.length && examples.length
    ? importOrList(examples)
    : msg('music.import.urlPlaceholder', { sources: sourceList(sources) });
}

/** Sample link chips, only for listed sources. */
export function importSampleLinks(sources: PlaylistImportSources): { source: string; label: string; url: string }[] {
  return sources.links
    .filter(source => SAMPLE_LINKS[source])
    .map(source => ({ source, label: msg('music.import.loadSampleLink', { source: importSourceName(source) }), url: SAMPLE_LINKS[source]! }));
}

export function importFileModeLabel(sources: PlaylistImportSources): string {
  return msg('music.import.modeFile', { formats: formatList(sources) });
}

export function importFileTextLabel(sources: PlaylistImportSources): string {
  return msg('music.import.fileTextLabel', { formats: formatList(sources) });
}

/** What a refusal means, naming what the server does read; '' for a code with no wording of its own. */
export function importRefusalMessage(code: string | undefined, sources: PlaylistImportSources | null): string {
  switch (code) {
    case 'unsupported_link':
      return sources?.links.length ? msg('music.import.unsupportedLink', { sources: sourceList(sources) }) : '';
    case 'unsupported_file':
      return sources?.files.length ? msg('music.import.unsupportedFile', { formats: formatList(sources) }) : '';
    case 'file_too_large':
      return msg('music.import.fileTooLarge');
    case 'invalid_choice':
      return msg('music.import.invalidChoice');
    default:
      return '';
  }
}
