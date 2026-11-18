import 'expo/src/Expo.fx';
// Test-only: exercise the real Jellyfin native URL helper against a bounded local
// fixture. The original plan stays credential-free; the diagnostic text is redacted.
import React, { useEffect, useState } from 'react';
import { AppRegistry, Text, View } from 'react-native';
import { VelaPlayer, VelaPlayerView } from '@vela/player';
import { JellyfinAdapter } from '../../../../packages/core/src/adapter/jellyfin';
import { redactMediaError } from '../../src/media-error';
const origin = 'http://192.168.68.65:38118';
const credentials = { device: { id: 'hls-fixture', name: 'HLS fixture', platform: 'ios', appVersion: '0.2.11' },
  get: async () => ({ accessToken: 'fixture-token' }) };
const adapter = new JellyfinAdapter(`${origin}/secure/`, credentials);
const plan = { sessionId: 'native-hls-grant-proof', revision: 1, sourceGeneration: 1, seekGeneration: 1,
  state: 'ready', positionSeconds: 0, selectedPathId: 'server-transcode',
  paths: [{ id: 'server-transcode', kind: 'transcode', transport: 'hls', readiness: 'ready', url: `${origin}/secure/hls/master.m3u8` }],
  audioTracks: [], subtitleTracks: [], selectedSubtitleTrackId: null, chapters: [], fallback: { state: 'unsupported' } };
function Probe() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('starting');
  const [diagnostic, setDiagnostic] = useState('');
  useEffect(() => {
    VelaPlayer.setMediaAccess({ origin, pathPrefix: '/secure/', headers: async () => ({ 'X-Emby-Token': 'fixture-token' }),
      nativeURL: async url => {
        const authorized = await adapter.nativePlaybackURL(url);
        setDiagnostic(redactMediaError(`adapter URL ${authorized}`));
        return authorized;
      } });
    const timer = setTimeout(() => setReady(true), 100);
    return () => { clearTimeout(timer); VelaPlayer.setMediaAccess(null); };
  }, []);
  return <View style={{ flex: 1, backgroundColor: 'black' }}>
    {ready && <VelaPlayerView plan={plan} style={{ flex: 1 }} onSnapshot={s => setStatus(`${s.state} ${Math.floor(s.position || 0)} ${s.backend || ''}`)}
      onError={error => setStatus(`error ${error.kind}`)} />}
    <Text style={{ color: 'white', fontSize: 24, position: 'absolute', top: 35, left: 35 }}>{status}{'\n'}{diagnostic}</Text>
  </View>;
}
AppRegistry.registerComponent('main', () => Probe);
