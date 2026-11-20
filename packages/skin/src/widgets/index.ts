// The compiled interactive parts documents place by name (`{ type: 'widget', widget: <name> }`).
// One line per widget; each lives in its own file or directory under widgets/. A name not listed
// draws nothing.
import type { ComponentType } from 'react';
import type { WidgetProps } from '../host';
import { GuideWidget, LiveTileWidget } from './guide';
import { PlayerChrome } from './player/chrome';
import { SearchInput } from './search-input';
import { ServerSwitcher } from './auth/server-switcher';
import { TextInput } from './auth/text-input';
import { HeroArtwork } from './common/hero-artwork';
import { CardPreview, HeroPreview } from './common/preview';
import { Select } from './common/select';
import { Sentinel } from './common/sentinel';
import { LibraryTabs, LibraryFacets, LibraryToolbar } from './library/presentation';
import { YearInput } from './library/year-input';

import { RowLink } from './row-link';
import { LoadingWidget } from './common/loading';
import { HomeSlowWidget } from './common/home-slow';

export const WIDGETS: Record<string, ComponentType<WidgetProps>> = {
  rowLink: RowLink,
  contentLoader: LoadingWidget,
  homeSlow: HomeSlowWidget,
  searchInput: SearchInput,
  textInput: TextInput,
  serverSwitcher: ServerSwitcher,
  select: Select,
  sentinel: Sentinel,
  cardPreview: CardPreview,
  heroPreview: HeroPreview,
  heroArtwork: HeroArtwork,
  playerChrome: PlayerChrome,
  guide: GuideWidget,
  liveTile: LiveTileWidget,
  yearInput: YearInput,
  libraryToolbar: LibraryToolbar,
  libraryTabs: LibraryTabs,
  libraryFacets: LibraryFacets,
};

/** The widgets that take focus themselves. The rest (sentinel, previews, the live tile) only draw,
 * so a TV focus guide around nothing but them would be an empty destination (render.tsx). */
export const FOCUSABLE_WIDGETS = new Set([
  'rowLink',
  'searchInput',
  'textInput',
  'serverSwitcher',
  'select',
  'playerChrome',
  'guide',
  'yearInput',
  'libraryToolbar',
  'libraryTabs',
  'libraryFacets',
  'homeSlow',
]);
