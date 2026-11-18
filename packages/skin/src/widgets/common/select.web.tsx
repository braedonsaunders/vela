// Widget `select` on the web: the browser's own select, filling the node's box (which draws the
// height, padding, border, radius and ground) in the node's inherited ink and font.
import type { CSSProperties } from 'react';
import { useInheritedText, type WidgetProps } from '../../host';
import { useLook } from './look';
import { useSelectModel } from './select-model';

export function Select(props: WidgetProps) {
  const model = useSelectModel(props);
  const drawn = useInheritedText().style;
  // The open list, where the browser lets a page colour it, wears the document's popover.
  const { ui } = useLook();
  const option: CSSProperties = { backgroundColor: ui.popover, color: ui.ink };
  const style: CSSProperties = {
    width: '100%',
    height: '100%',
    minWidth: 0,
    margin: 0,
    padding: 0,
    // Reserve room for the browser arrow even when the parent sizes to the label.
    paddingRight: 24,
    boxSizing: 'border-box',
    border: 'none',
    outlineOffset: 2,
    background: 'transparent',
    color: drawn.color as string | undefined,
    fontFamily: drawn.fontFamily,
    fontSize: drawn.fontSize,
    fontWeight: drawn.fontWeight as CSSProperties['fontWeight'],
    letterSpacing: drawn.letterSpacing,
    cursor: 'pointer',
  };
  return (
    <select
      value={model.value}
      onChange={event => model.choose(event.target.value)}
      aria-label={model.label || undefined}
      data-testid={props.params.testId}
      style={style}
    >
      {model.choices.map(choice => (
        <option key={choice.value} value={choice.value} style={option}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}
