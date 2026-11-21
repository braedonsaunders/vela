// The search field (widget `searchInput`, and the shell's `searchField` slot): the query the
// home and search routes read as env.query (held by the field, useQueryText). Its text takes the
// node's inherited text rows; while it is empty, its placeholder draws them as secondary text.
import { useContext, useMemo } from 'react';
import { Platform, type TextStyle } from 'react-native';
import { TextField } from './common/text-field';
import { withClientStrings } from '../resolve/client-strings';
import { useQueryText } from './search/query-text';
import { useSearchFocus } from './search/use-search-focus';
import { placeholderRows } from './search/placeholder-text';
import { fontSizeOf, textStyle } from '../translate';
import { InheritedContext, measure, useHost, useInheritedText, useWidgetInteraction, type WidgetProps } from '../host';

export function SearchInput({ params, ctx }: WidgetProps) {
  const host = useHost();
  const query = useQueryText();
  const input = useSearchFocus();
  const drawn = useInheritedText();
  const inherited = useContext(InheritedContext);
  const quiet = useMemo(() => {
    const m = measure(host.viewport, inherited.fontSize);
    const hint = placeholderRows(inherited.rows, inherited.fontSize, fontSizeOf('100px', inherited.fontSize, m) / 100);
    return textStyle(hint.rows, measure(host.viewport, hint.fontSize)).style;
  }, [inherited, host.viewport]);
  const interaction = useWidgetInteraction();
  const placeholder = params.placeholder ? withClientStrings(params.placeholder) : undefined;
  const label = params.label ? withClientStrings(params.label) : placeholder;
  const clearOnEscape = Platform.OS === 'web' ? { onKeyPress: (event: { nativeEvent: { key: string }; preventDefault?(): void }) => {
    if (event.nativeEvent.key !== 'Escape' || query.text === '') return;
    event.preventDefault?.();
    query.change('');
  } } : {};
  return (
    <TextField ref={input} value={query.text} onChangeText={query.change} placeholder={placeholder} accessibilityLabel={label}
      placeholderTextColor={params.placeholderColor ?? (drawn.style.color as string | undefined)} autoCorrect={false} autoCapitalize="none"
      returnKeyType="search" testID={`search-${ctx.index}`} nativeID="vela-search"
      {...clearOnEscape}
      onFocus={() => { host.setFlag('search-focused', true); interaction.report('focus', true); }}
      onBlur={() => { host.setFlag('search-focused', false); interaction.report('focus', false); }}
      style={[query.text === '' ? quiet : drawn.style, { flexGrow: 1, flexShrink: 1, minWidth: 0, padding: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as TextStyle]} />
  );
}
