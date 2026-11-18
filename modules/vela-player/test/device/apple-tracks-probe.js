import 'expo/src/Expo.fx';
// Test-only entry for the authenticated two-audio/SRT fixture from AETHER.md.
import React, { useEffect, useState } from 'react';
import { AppRegistry, Text, View } from 'react-native';
import { VelaPlayer, VelaPlayerView } from '@vela/player';
const origin = 'http://192.168.68.65:38117';
const plan = {
  sessionId: 'apple-track-proof', revision: 1, sourceGeneration: 1, seekGeneration: 1,
  state: 'ready', positionSeconds: 0, selectedPathId: 'fixture',
  paths: [{ id: 'fixture', kind: 'direct', transport: 'file', readiness: 'ready', original: true, url: `${origin}/secure/tracks.mkv` }],
  audioTracks: [{ id: 'english', name: 'English', streamIndex: 1 }, { id: 'spanish', name: 'Spanish', streamIndex: 2 }],
  subtitleTracks: [{ id: 'captions', name: 'English captions', streamIndex: 3, delivery: { kind: 'embedded' } }],
  selectedAudioTrackId: 'english', selectedSubtitleTrackId: null, chapters: [], fallback: { state: 'unsupported' },
};
function Probe() {
  const [ready, setReady] = useState(false);
  const [command, setCommand] = useState(null);
  const [status, setStatus] = useState('starting');
  useEffect(() => {
    VelaPlayer.setMediaAccess({ origin, pathPrefix: '/secure/', headers: async () => ({ 'X-Plex-Token': 'fixture-token' }) });
    const timers = [setTimeout(() => setReady(true), 100),
      setTimeout(() => setCommand({ id: 1, type: 'audio', trackId: 'spanish' }), 7000),
      setTimeout(() => setCommand({ id: 2, type: 'subtitle', trackId: 'captions' }), 12000),
      setTimeout(() => setCommand({ id: 3, type: 'subtitle', trackId: null }), 26000),
      setTimeout(() => setCommand({ id: 4, type: 'audio', trackId: 'english' }), 30000)];
    return () => timers.forEach(clearTimeout);
  }, []);
  return <View style={{ flex: 1, backgroundColor: 'black' }}>
    {ready && <VelaPlayerView plan={plan} command={command} style={{ flex: 1 }}
      onSnapshot={s => setStatus(`${s.state} ${Math.floor(s.position || 0)} audio=${s.audioTrackId} sub=${s.subtitleTrackId}`)}
      onCommand={event => console.log('[apple-tracks-command]', event.id, event.ok)}
      onError={error => console.log('[apple-tracks-error]', error.kind)} />}
    <Text style={{ color: 'white', fontSize: 28, position: 'absolute', top: 40, left: 40 }}>{status}</Text>
  </View>;
}
AppRegistry.registerComponent('main', () => Probe);
