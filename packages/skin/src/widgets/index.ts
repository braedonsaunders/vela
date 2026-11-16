// The compiled interactive parts documents place by name (`{ type: 'widget', widget: <name> }`).
// One line per widget; each lives in its own file or directory under widgets/. A name not listed
// draws nothing.
import type { ComponentType } from 'react';
import type { WidgetProps } from '../host';
import { SearchInput } from './search-input';
import { ServerSwitcher } from './auth/server-switcher';
import { TextInput } from './auth/text-input';
import { Select } from './common/select';
import { Sentinel } from './common/sentinel';

export const WIDGETS: Record<string, ComponentType<WidgetProps>> = {
  searchInput: SearchInput,
  textInput: TextInput,
  serverSwitcher: ServerSwitcher,
  select: Select,
  sentinel: Sentinel,
};
