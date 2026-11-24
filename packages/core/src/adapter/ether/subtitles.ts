// Ether's subtitle search (features.subtitleSearch): the advertised languages, and a search answer
// as the player's menu reads it. Only what the server says is kept; a malformed field is dropped,
// never guessed at.
import type * as V from '../../wire';
import type { ServerDescription } from '../index';
import type { RemoteSubtitle, SubtitleLanguages, SubtitleSearchResult } from '../media-actions';

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
const flag = (value: unknown) => value === true ? true : undefined;
const codes = (value: unknown) => Array.isArray(value) ? [...new Set(value.map(text).filter((code): code is string => !!code))] : [];

/** The languages an Ether search takes; null when the server has no search (older Ether, flag off). */
export function etherSubtitleLanguages(capabilities: ServerDescription): SubtitleLanguages | null {
  const feature = capabilities.features.subtitleSearch;
  const languages = codes(feature?.languages);
  return feature?.available === true && languages.length ? { languages: languages.map(code => ({ code })), preferred: [] } : null;
}

export function etherSubtitleOffer(offer: V.SubtitleOffer, searched: string): RemoteSubtitle | null {
  const id = text(offer?.id);
  if (!id) return null;
  const language = text(offer.language) ?? searched;
  const rating = typeof offer.rating === 'number' && Number.isFinite(offer.rating) && offer.rating >= 0 ? Math.min(10, offer.rating) : undefined;
  const result: RemoteSubtitle = { id, name: text(offer.name) ?? text(offer.provider) ?? language, language };
  const provider = text(offer.provider), format = text(offer.format), author = text(offer.author), downloads = count(offer.downloads);
  if (provider) result.provider = provider;
  if (format) result.format = format;
  if (author) result.author = author;
  if (downloads !== undefined) result.downloads = downloads;
  if (rating !== undefined) result.rating = rating;
  if (flag(offer.releaseMatch)) result.releaseMatch = true;
  if (flag(offer.hearingImpaired)) result.hearingImpaired = true;
  if (flag(offer.forced)) result.forced = true;
  if (flag(offer.aiTranslated)) result.aiTranslated = true;
  return result;
}

export function etherSubtitleSearch(answer: V.SubtitleSearchResponse, asked?: string): SubtitleSearchResult {
  const language = text(answer?.language) ?? asked ?? '';
  const offers = Array.isArray(answer?.offers) ? answer.offers.map(offer => etherSubtitleOffer(offer, language)).filter((offer): offer is RemoteSubtitle => !!offer) : [];
  return { language, offers, preferred: codes(answer?.preferredLanguages) };
}

/** How long a download may stay preparing (an AI translation) before Vela gives up on it. */
export const SUBTITLE_PREPARE_LIMIT_MS = 10 * 60_000;
/** The wait before asking again, from the server's hint, kept between one and ten seconds. */
export function subtitleRetryDelayMs(reply: V.PlaybackPreparing): number {
  const seconds = Number.isFinite(reply.retryAfterSeconds) ? reply.retryAfterSeconds : 2;
  return Math.min(10, Math.max(1, seconds)) * 1000;
}
