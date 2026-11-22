// A plugin screen (Sports) as a top-level section: drawn natively inside the active document's
// shell, live while it is the section on show.
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { HostContext } from '@vela/skin/src/host';
import { SportsActionsContext, SportsScreen } from '@vela/skin/src/widgets/sports';
import { useVela } from '../../../src/vela';
import { useSectionFocus } from '../../../src/section-focus';
import { useAppSportsActions } from '../../../src/sports/actions';

export default function PluginScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const vela = useVela();
  const host = vela.host('screen', id);
  const active = useSectionFocus() ?? false;
  const actions = useAppSportsActions();
  if (!host || !id) return <View style={{ flex: 1 }} />;
  return (
    <HostContext.Provider value={host}>
      <SportsActionsContext.Provider value={actions}>
        <SportsScreen id={id} active={active} />
      </SportsActionsContext.Provider>
    </HostContext.Provider>
  );
}
