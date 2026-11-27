// A quiet action under a step's buttons (Open Downloads, Use a code): words, not a button shape,
// but a full thumb-sized target and the same focus ring as every control.
import { APressable, NO_RING, overlaid, useInteraction, Words } from '../../common/controls';
import { useLook } from '../../common/look';

export function TextAction({ label, onPress, testID, disabled = false }: { label: string; onPress(): void; testID?: string; disabled?: boolean }) {
  const look = useLook();
  const { state, handlers } = useInteraction();
  const rows = overlaid({ height: '44px', 'padding-left': '16px', 'padding-right': '16px', 'border-radius': '22px', 'align-items': 'center', 'justify-content': 'center', 'align-self': 'center' }, state, {
    hover: { 'background-color': '$ui.control' },
    focus: { 'box-shadow': '0px 0px 0px 2px $ui.accent' },
    disabled: { opacity: '0.42' },
  }, disabled);
  return (
    <APressable accessibilityRole="button" accessibilityLabel={label} testID={testID} disabled={disabled} onPress={onPress} {...handlers}
      style={[look.box(rows), state.pressed && { opacity: 0.6 }, NO_RING]}>
      <Words rows={{ 'font-size': '15px', 'font-weight': '600', color: '$ui.inkSecondary' }}>{label}</Words>
    </APressable>
  );
}
