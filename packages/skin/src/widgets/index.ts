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
import { CardPreview, HeroPreview } from './common/preview';
import { Select } from './common/select';
import { Sentinel } from './common/sentinel';
import { YearInput } from './library/year-input';

export const WIDGETS: Record<string, ComponentType<WidgetProps>> = {
  searchInput: SearchInput,
  textInput: TextInput,
  serverSwitcher: ServerSwitcher,
  select: Select,
  sentinel: Sentinel,
  cardPreview: CardPreview,
  heroPreview: HeroPreview,
  playerChrome: PlayerChrome,
  guide: GuideWidget,
  liveTile: LiveTileWidget,
  yearInput: YearInput,
};
