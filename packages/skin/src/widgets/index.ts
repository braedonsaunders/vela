// The compiled interactive parts documents place by name (`{ type: 'widget', widget: <name> }`).
// One line per widget; each lives in its own file or directory under widgets/. A name not listed
// draws nothing.
import type { ComponentType } from 'react';
import type { WidgetProps } from '../host';
import { PlayerChrome } from './player/chrome';
import { SearchInput } from './search-input';

export const WIDGETS: Record<string, ComponentType<WidgetProps>> = {
  searchInput: SearchInput,
  playerChrome: PlayerChrome,
};
