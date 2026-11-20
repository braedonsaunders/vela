// The search field (widget `searchInput`, and the shell's `searchField` slot): the query the
// home and search routes read as env.query (held by the field, useQueryText). Its text takes the
// node's inherited text rows.
import { Platform, type TextStyle } from 'react-native';
import { TextField } from './common/text-field';
import { withClientStrings } from '../resolve/client-strings';
import { useQueryText } from './search/query-text';
import { useSearchFocus } from './search/use-search-focus';
import { useHost, useInheritedText, useWidgetInteraction, type WidgetProps } from '../host';

export function SearchInput({ params, ctx }: WidgetProps) {
  const host = useHost();
  const query = useQueryText();
  const input = useSearchFocus();
  const drawn = useInheritedText();
  const interaction = useWidgetInteraction();
  const placeholder = params.placeholder ? withClientStrings(params.placeholder) : undefined;
  const label = params.label ? withClientStrings(params.label) : placeholder;
  return (
    <TextField ref={input} value={query.text} onChangeText={query.change} placeholder={placeholder} accessibilityLabel={label}
      placeholderTextColor={params.placeholderColor ?? (drawn.style.color as string | undefined)} autoCorrect={false} autoCapitalize="none"
      returnKeyType="search" testID={`search-${ctx.index}`} nativeID="vela-search"
      onFocus={() => { host.setFlag('search-focused', true); interaction.report('focus', true); }}
      onBlur={() => { host.setFlag('search-focused', false); interaction.report('focus', false); }}
      style={[drawn.style, { flexGrow: 1, flexShrink: 1, minWidth: 0, padding: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as TextStyle]} />
  );
}
