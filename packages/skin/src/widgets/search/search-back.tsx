// Apple TV search's way out: a Back pill at the top left of the results, right under the system
// keyboard, in the document's look and its search controls' focus (lift, accent ring, halo, raised
// fill). It scrolls away with the keyboard. Menu leaves search too; this is the visible way.
import { msg } from '@vela/core';
import { View } from 'react-native';
import { gutter } from '../../resolve/vela-base/look';
import { searchControlFocus } from '../../resolve/vela-base/search';
import { APressable, Glyph, NO_RING, overlaid, useInteraction, Words } from '../common/controls';
import { useLook } from '../common/look';

/** The testID native search reads to keep Return's focus on what was found, not on Back. */
export const SEARCH_BACK_ID = 'search-back';

export function SearchBack({ onPress }: { onPress(): void }) {
  const look = useLook();
  const { state, handlers } = useInteraction();
  const rows = overlaid(
    {
      display: 'flex',
      'flex-direction': 'row',
      'align-items': 'center',
      gap: '8px',
      height: '44px',
      'padding-left': '14px',
      'padding-right': '20px',
      'border-radius': '$ui.radiusControl',
      border: '1px solid $ui.glassEdge',
      'background-color': '$ui.control',
      color: '$ui.ink',
      transition: 'background-color 180ms linear, scale 360ms cubic-bezier(0.16, 1, 0.3, 1)',
    },
    state,
    { focus: { ...searchControlFocus, 'border-color': '$ui.accent' } },
  );
  const label = msg('ui.back');
  return (
    <View style={[look.box({ ...gutter }), { flexDirection: 'row' }]}>
      <APressable
        testID={SEARCH_BACK_ID}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={[look.box(rows), NO_RING]}
        {...handlers}
      >
        <View style={{ transform: [{ rotate: '180deg' }] }}>
          <Glyph symbol="forward-chevron" size={16} color={look.ui.ink} />
        </View>
        <Words rows={{ 'font-size': '14px', 'font-weight': '600' }} lines={1}>{label}</Words>
      </APressable>
    </View>
  );
}
