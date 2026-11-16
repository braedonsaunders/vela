// The search field (widget `searchInput`, and the shell's `searchField` slot): the query the
// home and search routes read as env.query. Its text takes the node's inherited text rows.
import { Platform, TextInput, type TextStyle } from 'react-native';
import { withClientStrings } from '../../../../client/src/skin/client-strings';
import { useHost, useInheritedText, useWidgetInteraction, type WidgetProps } from '../host';

export function SearchInput({ params, ctx }: WidgetProps) {
  const host = useHost();
  const drawn = useInheritedText();
  const interaction = useWidgetInteraction();
  const placeholder = params.placeholder ? withClientStrings(params.placeholder) : undefined;
  const label = params.label ? withClientStrings(params.label) : placeholder;
  return (
    <TextInput value={host.env.query} onChangeText={host.setQuery} placeholder={placeholder} accessibilityLabel={label}
      placeholderTextColor={params.placeholderColor ?? (drawn.style.color as string | undefined)} autoCorrect={false} autoCapitalize="none"
      returnKeyType="search" testID={`search-${ctx.index}`} nativeID="vela-search"
      onFocus={() => { host.setFlag('search-focused', true); interaction.report('focus', true); }}
      onBlur={() => { host.setFlag('search-focused', false); interaction.report('focus', false); }}
      style={[drawn.style, { flex: 1, minWidth: 0, padding: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as TextStyle]} />
  );
}
