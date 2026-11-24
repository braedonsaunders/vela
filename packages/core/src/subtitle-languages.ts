// Subtitle search languages: naming a server's codes, matching the viewer's preferred languages
// against them, and the order a picker lists them in (preferred first, then the rest by name).
// Servers speak different codes for one language (Ether and Plex 'nl', Jellyfin 'dut' or 'nld'),
// so matching goes through ISO 639-1 where the table knows the language.
import { localeContext } from './i18n';

/** ISO 639-1, ISO 639-2/T, ISO 639-2/B where it differs, English name. */
const TABLE: readonly (readonly [string, string, string, string])[] = [
  ['af', 'afr', '', 'Afrikaans'], ['ar', 'ara', '', 'Arabic'], ['bg', 'bul', '', 'Bulgarian'], ['bn', 'ben', '', 'Bengali'],
  ['bs', 'bos', '', 'Bosnian'], ['ca', 'cat', '', 'Catalan'], ['cs', 'ces', 'cze', 'Czech'], ['cy', 'cym', 'wel', 'Welsh'],
  ['da', 'dan', '', 'Danish'], ['de', 'deu', 'ger', 'German'], ['el', 'ell', 'gre', 'Greek'], ['en', 'eng', '', 'English'],
  ['eo', 'epo', '', 'Esperanto'], ['es', 'spa', '', 'Spanish'], ['et', 'est', '', 'Estonian'], ['eu', 'eus', 'baq', 'Basque'],
  ['fa', 'fas', 'per', 'Persian'], ['fi', 'fin', '', 'Finnish'], ['fr', 'fra', 'fre', 'French'], ['ga', 'gle', '', 'Irish'],
  ['gl', 'glg', '', 'Galician'], ['he', 'heb', '', 'Hebrew'], ['hi', 'hin', '', 'Hindi'], ['hr', 'hrv', '', 'Croatian'],
  ['hu', 'hun', '', 'Hungarian'], ['hy', 'hye', 'arm', 'Armenian'], ['id', 'ind', '', 'Indonesian'], ['is', 'isl', 'ice', 'Icelandic'],
  ['it', 'ita', '', 'Italian'], ['ja', 'jpn', '', 'Japanese'], ['ka', 'kat', 'geo', 'Georgian'], ['kk', 'kaz', '', 'Kazakh'],
  ['km', 'khm', '', 'Khmer'], ['kn', 'kan', '', 'Kannada'], ['ko', 'kor', '', 'Korean'], ['ku', 'kur', '', 'Kurdish'],
  ['la', 'lat', '', 'Latin'], ['lb', 'ltz', '', 'Luxembourgish'], ['lt', 'lit', '', 'Lithuanian'], ['lv', 'lav', '', 'Latvian'],
  ['mk', 'mkd', 'mac', 'Macedonian'], ['ml', 'mal', '', 'Malayalam'], ['mn', 'mon', '', 'Mongolian'], ['mr', 'mar', '', 'Marathi'],
  ['ms', 'msa', 'may', 'Malay'], ['my', 'mya', 'bur', 'Burmese'], ['nb', 'nob', '', 'Norwegian Bokmål'], ['ne', 'nep', '', 'Nepali'],
  ['nl', 'nld', 'dut', 'Dutch'], ['nn', 'nno', '', 'Norwegian Nynorsk'], ['no', 'nor', '', 'Norwegian'], ['pa', 'pan', '', 'Punjabi'],
  ['pl', 'pol', '', 'Polish'], ['ps', 'pus', '', 'Pashto'], ['pt', 'por', '', 'Portuguese'], ['ro', 'ron', 'rum', 'Romanian'],
  ['ru', 'rus', '', 'Russian'], ['si', 'sin', '', 'Sinhala'], ['sk', 'slk', 'slo', 'Slovak'], ['sl', 'slv', '', 'Slovenian'],
  ['so', 'som', '', 'Somali'], ['sq', 'sqi', 'alb', 'Albanian'], ['sr', 'srp', '', 'Serbian'], ['sv', 'swe', '', 'Swedish'],
  ['sw', 'swa', '', 'Swahili'], ['ta', 'tam', '', 'Tamil'], ['te', 'tel', '', 'Telugu'], ['th', 'tha', '', 'Thai'],
  ['tl', 'tgl', '', 'Tagalog'], ['tr', 'tur', '', 'Turkish'], ['uk', 'ukr', '', 'Ukrainian'], ['ur', 'urd', '', 'Urdu'],
  ['uz', 'uzb', '', 'Uzbek'], ['vi', 'vie', '', 'Vietnamese'], ['zh', 'zho', 'chi', 'Chinese'],
];
const byCode = new Map<string, readonly [string, string, string, string]>();
for (const row of TABLE) for (const code of row.slice(0, 3)) if (code) byCode.set(code, row);

/** The ISO 639-1 codes the table knows, for a server (Plex) that publishes no list of its own. */
export const KNOWN_SUBTITLE_LANGUAGES: readonly string[] = TABLE.map(row => row[0]);

export interface SubtitleLanguage { code: string; /** The server's own name for it, when it has one. */ name?: string }

/** A comparable key: 'nl', 'dut', 'nld' and 'NL' are 'nl'; a region stays ('pt-br'); unknown codes stay as written. */
export function languageKey(code: string): string {
  const [base = '', ...rest] = code.trim().replace(/_/g, '-').toLowerCase().split('-');
  const primary = byCode.get(base)?.[0] ?? base;
  const region = rest.find(part => /^[a-z]{2}$|^\d{3}$/.test(part));
  return region ? `${primary}-${region}` : primary;
}
const baseKey = (code: string) => languageKey(code).split('-')[0]!;

/** The two-letter code a server wanting ISO 639-1 takes, or the code unchanged. */
export function iso6391(code: string): string { return baseKey(code); }
/** The bibliographic three-letter code (Jellyfin's and Plex's languageCode), or the code unchanged. */
export function iso6392(code: string): string { const row = byCode.get(baseKey(code)); return row ? row[2] || row[1] : code; }

let names: { locale: string; format?: { of(code: string): string | undefined } } | undefined;
/** A language's name in the viewer's language where the platform can say it (not Hermes), else English. */
export function languageLabel(code: string, name?: string): string {
  if (name?.trim()) return name.trim();
  const key = languageKey(code);
  const locale = localeContext().resolvedLocale;
  if (names?.locale !== locale) {
    names = { locale };
    try {
      const DisplayNames = (Intl as unknown as { DisplayNames?: new (locales: string[], options: { type: 'language' }) => { of(code: string): string | undefined } }).DisplayNames;
      if (DisplayNames) names.format = new DisplayNames([locale], { type: 'language' });
    } catch { /* Not every engine has it. */ }
  }
  try {
    const shown = names.format?.of(key);
    if (shown && shown.toLowerCase() !== key) return shown.charAt(0).toLocaleUpperCase() + shown.slice(1);
  } catch { /* An unknown code falls through to the table. */ }
  const row = byCode.get(key.split('-')[0]!);
  if (!row) return code;
  const region = key.split('-')[1];
  return region ? `${row[3]} (${region.toUpperCase()})` : row[3];
}

/** The device's languages, most preferred first (the app's locale, then the browser's list). */
export function deviceLanguages(): string[] {
  const list = [localeContext().locale];
  const browser = (globalThis as { navigator?: { languages?: readonly string[] } }).navigator?.languages;
  if (Array.isArray(browser)) list.push(...browser);
  return list.filter(Boolean);
}

/** One server language for a preferred code: the same tag first, then the same language in any region. */
function match(languages: readonly SubtitleLanguage[], code: string): SubtitleLanguage | undefined {
  const key = languageKey(code);
  return languages.find(language => languageKey(language.code) === key)
    ?? languages.find(language => baseKey(language.code) === key.split('-')[0]);
}

/** A picker's two groups: the viewer's languages the server has, in preference order, then every
 * other language by name. Nothing is listed twice; preferred codes the server lacks are dropped. */
export function orderSubtitleLanguages(languages: readonly SubtitleLanguage[], preferred: readonly string[]): { preferred: SubtitleLanguage[]; others: SubtitleLanguage[] } {
  const unique: SubtitleLanguage[] = [];
  const seen = new Set<string>();
  for (const language of languages) {
    const key = languageKey(language.code);
    if (!seen.has(key)) { seen.add(key); unique.push(language); }
  }
  const first: SubtitleLanguage[] = [];
  for (const code of preferred) {
    const found = code ? match(unique, code) : undefined;
    if (found && !first.includes(found)) first.push(found);
  }
  const others = unique.filter(language => !first.includes(language))
    .map(language => ({ language, label: languageLabel(language.code, language.name) }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(({ language }) => language);
  return { preferred: first, others };
}

/** The language a search starts in: the viewer's most preferred one the server has, else its first. */
export function pickSubtitleLanguage(languages: readonly SubtitleLanguage[], preferred: readonly string[]): string | undefined {
  return orderSubtitleLanguages(languages, preferred).preferred[0]?.code ?? languages[0]?.code;
}

/** Whether two codes name the same language (and region, when both give one). */
export function sameLanguage(a: string, b: string): boolean {
  const left = languageKey(a), right = languageKey(b);
  return left === right || (!left.includes('-') || !right.includes('-')) && left.split('-')[0] === right.split('-')[0];
}
