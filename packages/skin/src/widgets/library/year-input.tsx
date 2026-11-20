// Widget `yearInput` (library pages, renderer 11): the number field on `library.year`. Typing a
// whole year, or clearing the field, filters the library by it (`libraryFilter year|…`); a year
// half typed waits. The renderer draws the node's box around it; the field fills that box in the
// inherited ink and font. `params`: placeholder, label, placeholderColor.
import { useEffect, useState } from 'react';
import { Platform, type TextStyle } from 'react-native';
import { TextField } from '../common/text-field';
import { colour } from '../../css';
import { useHost, useInheritedText, useWidgetInteraction, type WidgetProps } from '../../host';

const YEAR_DIGITS = 4;

export function YearInput({ params }: WidgetProps) {
  const host = useHost();
  const drawn = useInheritedText();
  const interaction = useWidgetInteraction();
  const model = host.env.library?.model;
  const filtered = model && model.yearFilter > 0 ? String(model.yearFilter) : '';
  const [text, setText] = useState(filtered);

  // Another control (a reset, Back to an older view) changed the year: show the year in force.
  useEffect(() => setText(filtered), [filtered]);

  if (!model?.canYear) return null;

  const edit = (typed: string) => {
    const digits = typed.replace(/[^0-9]/g, '').slice(0, YEAR_DIGITS);
    setText(digits);
    if ((digits === '' || digits.length === YEAR_DIGITS) && digits !== filtered) {
      host.dispatch('libraryFilter', `year|${digits}`);
    }
  };
  const style: TextStyle = {
    flex: 1,
    alignSelf: 'stretch',
    minWidth: 0,
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : {}),
  };
  return (
    <TextField
      value={text}
      onChangeText={edit}
      onFocus={() => interaction.report('focus', true)}
      onBlur={() => interaction.report('focus', false)}
      onPointerEnter={() => interaction.report('hover', true)}
      onPointerLeave={() => interaction.report('hover', false)}
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={YEAR_DIGITS}
      returnKeyType="done"
      placeholder={params.placeholder || undefined}
      placeholderTextColor={
        (params.placeholderColor && colour(params.placeholderColor)) || (drawn.style.color as string | undefined)
      }
      accessibilityLabel={params.label || params.placeholder || undefined}
      testID={params.testId}
      style={[drawn.style, style, Platform.OS === 'web' && { fontSize: 16 }]}
    />
  );
}
