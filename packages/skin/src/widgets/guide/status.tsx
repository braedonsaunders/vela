// The guide's honest states: loading, failed (with Try again), no channels, nothing matching.
import { ActivityIndicator, View } from 'react-native';
import { msg } from '../../../../../client/foundation/i18n';
import type { GuideLook } from './look';
import { Line, Press } from './parts';

interface StatusProps {
  look: GuideLook;
  text: string;
  busy?: boolean;
  /** A button under the text: Try again by default. */
  onRetry?: () => void;
  action?: string;
}

export function GuideStatus({ look, text, busy, onRetry, action }: StatusProps) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32, backgroundColor: look.page }}>
      {busy ? <ActivityIndicator color={look.accent} /> : null}
      <Line look={look} size={17} color={look.inkSecondary} lines={0} style={{ textAlign: 'center' }}>{text}</Line>
      {onRetry ? (
        <Press
          label={action ?? msg('ui.tryAgain')}
          onPress={onRetry}
          style={({ hovered, focused }) => ({
            height: 42, paddingHorizontal: 20, justifyContent: 'center', borderRadius: look.radiusControl,
            borderWidth: 1, borderColor: hovered ? look.edgeStrong : look.edge, backgroundColor: look.control,
            boxShadow: focused ? `0px 0px 0px 2px ${look.page}, 0px 0px 0px 4px ${look.accent}` : undefined,
          })}
        >
          <Line look={look} size={14}>{action ?? msg('ui.tryAgain')}</Line>
        </Press>
      ) : null}
    </View>
  );
}
