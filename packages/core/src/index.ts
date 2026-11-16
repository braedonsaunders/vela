// @vela/core: server adapters, sessions and the server registry, discovery models, search,
// live TV, telemetry, appearance and the string catalogs. No React, no DOM, no React Native;
// the React bindings are `@vela/core/react`.
export { artworkURL, type Images } from './discovery/artwork';
export { card, detailModel, entry, feedRow, homeModel } from './discovery/models';
export { clock, localeContext, minute, msg, number, percent, plural, second, setLocale, time, withLocale } from './i18n';
export type { LocaleContext } from './i18n';
export { VelaError } from './adapter/errors';
export { guideFocus, liveIdentity, loadGuide } from './live/guide';
export type { GuideApi, GuideChannel, GuideModel, GuideProgramme } from './live/guide';
export { liveSearch } from './live/search';
export { randomId } from './protocol/id';
