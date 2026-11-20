import { msg } from '@vela/core';
import { View } from 'react-native';
import type { Ctx } from '../vocabulary';
import { Select } from './common/select';
import { useLook } from './common/look';

/** Dense series use one bounded chooser instead of an increasingly long clipped chip row. */
export function SeasonSelector({ ctx }: { ctx: Ctx }) {
  const look = useLook();
  return (
    <View style={look.box({
      width: 'min(320px, 80vw)', height: '48px', padding: '0px 14px',
      'border-radius': '$ui.radiusControl', border: '1px solid $ui.glassEdgeStrong',
      'background-color': '$ui.control', color: '$ui.ink',
    })}>
      <Select ctx={ctx} params={{
        options: 'detail.seasons', action: 'select', arg: '{value}|season|',
        label: msg('ui.seasons'), testId: 'season-picker-select',
      }} />
    </View>
  );
}
