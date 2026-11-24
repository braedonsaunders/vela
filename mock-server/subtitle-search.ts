// Subtitle search (features.subtitleSearch), as Ether answers it: offers from a fictional subtitle
// site with their downloads, rating and release match, plus an AI translation that takes a moment
// to prepare (HTTP 202 until it is ready). A chosen offer joins the session as an external WebVTT
// track whose cues name its language, so a player shows which one it is drawing.
import type { PlaybackPlan, PlaybackPreparing, SubtitleOffer, SubtitleSearchResponse, Track } from '../packages/protocol/types';
import { fixtureDurationSeconds } from './media';

/** What the mock searches: ISO 639-1, one regional tag. */
export const subtitleLanguages = ['en', 'nl', 'de', 'fr', 'es', 'it', 'pt', 'pt-BR', 'sv', 'da', 'no', 'fi', 'pl', 'cs', 'ja', 'ko', 'zh', 'ar', 'he', 'tr'];
/** The demo viewer's subtitle languages, as Ether keeps them (VELA_MOCK_SUBTITLE_LANGUAGES=nl,en). */
export const preferredSubtitleLanguages = (process.env.VELA_MOCK_SUBTITLE_LANGUAGES ?? 'nl,en').split(',').map(code => code.trim()).filter(Boolean);
/** How long an AI translation prepares before it is ready. */
const TRANSLATE_MS = Math.min(60_000, Math.max(0, Number(process.env.VELA_MOCK_TRANSLATE_MS ?? 3000) || 0));

const names: Record<string, [string, string]> = {
  en: ['English', 'Signal received'], nl: ['Dutch', 'Signaal ontvangen'], de: ['German', 'Signal empfangen'], fr: ['French', 'Signal reçu'],
  es: ['Spanish', 'Señal recibida'], it: ['Italian', 'Segnale ricevuto'], pt: ['Portuguese', 'Sinal recebido'], 'pt-BR': ['Portuguese (Brazil)', 'Sinal recebido'],
  sv: ['Swedish', 'Signal mottagen'], da: ['Danish', 'Signal modtaget'], no: ['Norwegian', 'Signal mottatt'], fi: ['Finnish', 'Signaali vastaanotettu'],
  pl: ['Polish', 'Sygnał odebrany'], cs: ['Czech', 'Signál přijat'], ja: ['Japanese', '信号を受信しました'], ko: ['Korean', '신호 수신'],
  zh: ['Chinese', '已收到信号'], ar: ['Arabic', 'تم استلام الإشارة'], he: ['Hebrew', 'האות התקבל'], tr: ['Turkish', 'Sinyal alındı'],
};

interface Found { offer: SubtitleOffer; titleId?: string }
interface Download { at: number }
/** Per session: the offers its searches returned (only those can be downloaded), and each offer's download
 * (made once per session: asking again while it prepares joins the same work). */
const searches = new Map<string, Map<string, Found>>();
const downloads = new Map<string, Download>();

function offersFor(language: string, titleId = 'title'): SubtitleOffer[] {
  const [name] = names[language] ?? [language];
  const release = `Vela.Studio.${titleId}.2160p.WEB-DL`;
  const offers: SubtitleOffer[] = [
    { id: `site-${language}-1`, language, name: `${release}.${language}`, provider: 'SubtitleSite', format: 'srt', author: 'mock-uploader', downloads: 48213, rating: 8.7, releaseMatch: true },
    { id: `site-${language}-2`, language, name: `${release}.${language}.SDH`, provider: 'SubtitleSite', format: 'srt', downloads: 1290, rating: 6.4, hearingImpaired: true },
    { id: `site-${language}-3`, language, name: `${name} forced (signs only)`, provider: 'SubtitleSite', format: 'ass', downloads: 87, forced: true },
  ];
  // Ether translates the title's own English subtitle; there is nothing to translate into English.
  if (language !== 'en') offers.push({ id: `ai-${language}`, language, name: `${name} (from English)`, provider: 'Ether', format: 'vtt', aiTranslated: true });
  return offers;
}

export function searchSubtitles(plan: PlaybackPlan, language: string | null): SubtitleSearchResponse {
  const searched = language ?? preferredSubtitleLanguages.find(code => subtitleLanguages.includes(code)) ?? 'en';
  const offers = subtitleLanguages.includes(searched) ? offersFor(searched, plan.titleId) : [];
  const found = searches.get(plan.sessionId) ?? new Map<string, Found>();
  for (const offer of offers) found.set(offer.id, { offer, titleId: plan.titleId });
  searches.set(plan.sessionId, found);
  return { language: searched, offers, preferredLanguages: preferredSubtitleLanguages };
}

/** The plan with the chosen offer's track added and selected; 202 while an AI translation prepares.
 * `undefined` means the session never saw that offer. */
export function downloadSubtitle(plan: PlaybackPlan, mediaBase: string, offerId: string): PlaybackPlan | PlaybackPreparing | undefined {
  const found = searches.get(plan.sessionId)?.get(offerId);
  if (!found) return undefined;
  const id = `${plan.sessionId}:${offerId}`;
  const download = downloads.get(id) ?? { at: Date.now() };
  downloads.set(id, download);
  const wait = found.offer.aiTranslated ? download.at + TRANSLATE_MS - Date.now() : 0;
  if (wait > 0) return { state: 'preparing', retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) };
  const trackId = `found-${offerId}`;
  if (!plan.subtitleTracks.some(track => track.id === trackId)) {
    const { offer } = found;
    const [name] = names[offer.language] ?? [offer.language];
    const track: Track = { id: trackId, kind: 'subtitle', language: offer.language, codec: 'webvtt',
      name: offer.aiTranslated ? `${name} · AI translation` : `${name} · ${offer.provider}`,
      ...(offer.hearingImpaired ? { hearingImpaired: true } : {}), ...(offer.forced ? { forced: true } : {}),
      delivery: { kind: 'external', format: 'webvtt', url: `${mediaBase}/found-subtitles/${encodeURIComponent(offerId)}.vtt` } };
    plan.subtitleTracks.push(track);
  }
  plan.selectedSubtitleTrackId = trackId;
  return plan;
}

/** The WebVTT of a downloaded offer: one cue every four seconds naming its language and source. */
export function foundSubtitleVtt(sessionId: string, offerId: string): string | undefined {
  const found = searches.get(sessionId)?.get(offerId);
  if (!found) return undefined;
  const { offer } = found;
  const [name, line] = names[offer.language] ?? [offer.language, offer.language];
  const source = offer.aiTranslated ? 'AI translation' : offer.provider;
  const stamp = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000`;
  const cues = Array.from({ length: Math.ceil(fixtureDurationSeconds / 4) }, (_, n) =>
    `${stamp(n * 4)} --> ${stamp(n * 4 + 3)}\n${line} · ${name}\n(${source}, ${n * 4}s)`);
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

