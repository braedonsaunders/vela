import { useEffect, useState } from 'react';
import { BackHandler, Modal, Platform, ScrollView, View } from 'react-native';
import type { PlexHomeProfile } from '../../../../protocol/types';
import { Alert, Label, Pill, Waiting } from '../common/controls';
import { useLook } from '../common/look';
import { ProfilePicker } from './connect/plex';

export function PlexProfileDialog({ profiles, currentProfileId, error, onChoose, onRestart, onClose }: {
  profiles: PlexHomeProfile[];
  currentProfileId: string;
  error: string;
  onChoose(id: string, pin?: string): Promise<void>;
  onRestart(): Promise<void>;
  onClose(): void;
}) {
  const look = useLook();
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await work(); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (Platform.OS === 'web') {
      const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
      window.addEventListener('keydown', close);
      return () => window.removeEventListener('keydown', close);
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);
  return <Modal visible transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
    <View accessibilityViewIsModal accessibilityRole="dialog" accessibilityLabel="Switch Plex Home profile"
      style={[look.box({ position: 'absolute', top: '0px', right: '0px', bottom: '0px', left: '0px', 'background-color': '#050608dd', 'align-items': 'center', 'justify-content': 'center', padding: '16px' })]}>
      <View style={[look.box({ width: 'min(680px, 96%)', 'max-height': '92%', padding: '24px', gap: '16px', 'border-radius': '24px', border: '1px solid $ui.glassEdgeStrong', 'background-color': '$ui.popover' })]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}><Label>SWITCH PLEX HOME PROFILE</Label></View>
          <Pill label="Close" disabled={busy} onPress={onClose} testID="plex-profile-close" />
        </View>
        {profiles.length ? <ProfilePicker profiles={profiles} currentProfileId={currentProfileId} busy={busy}
          onChoose={(id, pin) => void run(() => onChoose(id, pin))} /> : null}
        {error ? <Alert>{error}</Alert> : null}
        {!profiles.length && !error ? <Waiting>Loading Plex Home profiles…</Waiting> : null}
        {!profiles.length && error ? <ScrollView contentContainerStyle={{ gap: 12 }}><Pill primary label="Start again" disabled={busy}
          busy={busy} onPress={() => void run(onRestart)} testID="plex-profile-restart" /></ScrollView> : null}
      </View>
    </View>
  </Modal>;
}
