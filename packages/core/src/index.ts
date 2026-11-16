// @vela/core: server adapters, sessions and the server registry, discovery models, search,
// live TV, telemetry, appearance and the string catalogs. No React, no DOM, no React Native;
// the React bindings are `@vela/core/react`.
export { artworkURL, type Images } from './discovery/artwork';
export { card, detailModel, entry, feedRow, homeModel } from './discovery/models';
export { clock, localeContext, minute, msg, number, percent, plural, second, setLocale, time, withLocale } from './i18n';
export type { LocaleContext } from './i18n';
export { randomId } from './protocol/id';
export * from './models';
export { createVela, type Vela, type VelaOptions, type VelaState } from './store';
export type { MediaCapabilities, VelaPlatform } from './store/platform';
export type { Load, Loadable } from './store/state';
export type { AuthPhase, AuthState, QuickCode } from './store/auth';
export type { PlexChoiceOption, PlexLinkView, ProbeResult, ServerOption, ServerResult, ServersState } from './store/servers';
export type { HomeRetry, HomeState } from './store/home';
export { libraryKey, type LibraryQuery } from './store/catalogue';
export type { LiveChannelResult, LiveProgrammeResult, SearchLane, SearchState } from './store/search';
export type { MediaAccessGrant, PlaybackPhase, PlaybackState, PlaybackTarget } from './store/playback';
export type { LiveState } from './store/live';
export type { Preview } from './store/previews';
export type { ReceiptKind } from './store/receipts';
export type { AppearanceModel, DocEntryModel } from './appearance';
export type { GuideChannel, GuideModel, GuideProgramme } from './live/guide';
export type { SecretStore } from './session';
export type { ServerKind } from './session/servers';
