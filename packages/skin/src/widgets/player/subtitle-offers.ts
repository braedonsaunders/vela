// What a subtitle search result says about itself, as the menu shows it: the facts that decide a
// pick as chips (an AI translation, made for this release, hearing impaired, forced, where from)
// and its standing (downloads, rating) as one quiet line.
import { languageLabel, msg, number, plural, type RemoteSubtitle } from '@vela/core';

export interface OfferFacts { chips: string[]; status: string }

/** `searched` is the language asked for: an offer in another (a regional variant) names its own. */
export function subtitleOfferFacts(offer: RemoteSubtitle, searched: string): OfferFacts {
  const chips = [
    offer.aiTranslated ? msg('player.subtitleSearch.ai') : '',
    offer.releaseMatch ? msg('player.subtitleSearch.releaseMatch') : '',
    offer.hearingImpaired ? msg('player.subtitleSearch.hearingImpaired') : '',
    offer.forced ? msg('player.subtitleSearch.forced') : '',
    languageLabel(offer.language) !== languageLabel(searched) ? languageLabel(offer.language) : '',
    offer.provider ?? '',
    offer.format ? offer.format.toUpperCase() : '',
  ].filter(Boolean);
  const status = [
    offer.downloads !== undefined ? msg(`player.subtitleSearch.downloads.${plural(offer.downloads)}`, { count: number(offer.downloads) }) : '',
    offer.rating !== undefined && offer.rating > 0 ? msg('player.subtitleSearch.rating', { value: number(offer.rating, { maximumFractionDigits: 1 }) }) : '',
    offer.author ? msg('player.subtitleSearch.by', { author: offer.author }) : '',
  ].filter(Boolean).join(' · ');
  return { chips: [...new Set(chips)], status };
}
