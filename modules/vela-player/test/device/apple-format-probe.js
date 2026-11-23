import 'expo/src/Expo.fx';
// Test-only entry: plays a local HEVC Main 10 fixture with TrueHD, E-AC-3 and DTS tracks and styled ASS
// and SRT subtitles, cycling the delivery and subtitle commands, and prints the info card's
// source → output lines. Build with ENTRY_FILE pointing here; serve the fixture on 127.0.0.1:38200.
import React, { useEffect, useState } from 'react';
import { AppRegistry, Text, View } from 'react-native';
import { VelaPlayer, VelaPlayerView } from '@vela/player';
import { formatLines } from '../../../../packages/skin/src/widgets/player/format';
const origin = 'http://127.0.0.1:38200';
const plan = {
  sessionId: 'apple-format-proof', revision: 1, sourceGeneration: 1, seekGeneration: 1,
  state: 'ready', positionSeconds: 0, selectedPathId: 'fixture',
  paths: [{ id: 'fixture', kind: 'direct', transport: 'file', readiness: 'ready', original: true, range: true, url: `${origin}/formats.mkv` }],
  audioTracks: [{ id: 'truehd', name: 'TrueHD', streamIndex: 1 }, { id: 'eac3', name: 'E-AC-3', streamIndex: 2 }, { id: 'dts', name: 'DTS', streamIndex: 5 }],
  subtitleTracks: [{ id: 'ass', name: 'Styled ASS', streamIndex: 3, delivery: { kind: 'embedded' } }, { id: 'srt', name: 'SRT', streamIndex: 4, delivery: { kind: 'embedded' } }],
  selectedAudioTrackId: 'truehd', selectedSubtitleTrackId: null, chapters: [], fallback: { state: 'unsupported' },
};
const steps = [
  [3000, { type: 'subtitle', trackId: 'ass' }],
  [9000, { type: 'outputPreference', value: 'surround=compatible' }],
  [16000, { type: 'audio', trackId: 'eac3' }],
  [22000, { type: 'audio', trackId: 'dts' }],
  [28000, { type: 'subtitle', trackId: 'srt' }],
  [30000, { type: 'subtitleStyle', value: 'subtitleSize=large' }],
  [32000, { type: 'subtitleStyle', value: 'subtitleOffset=1.5' }],
  [36000, { type: 'outputPreference', value: 'surround=lossless' }],
  [40000, { type: 'subtitleStyle', value: 'subtitleSize=medium' }],
];
function Probe() {
  const [ready, setReady] = useState(false);
  const [command, setCommand] = useState(null);
  const [lines, setLines] = useState(['starting']);
  useEffect(() => {
    VelaPlayer.setMediaAccess({ origin, pathPrefix: '/', headers: async () => ({}) });
    const timers = [setTimeout(() => setReady(true), 100),
      ...steps.map(([at, step], index) => setTimeout(() => setCommand({ id: index + 1, ...step }), at))];
    return () => timers.forEach(clearTimeout);
  }, []);
  return <View style={{ flex: 1, backgroundColor: 'black' }}>
    {ready && <VelaPlayerView plan={plan} command={command} style={{ flex: 1 }}
      onSnapshot={s => {
        const f = formatLines(s.format);
        const next = [`${s.state} ${Math.floor(s.position || 0)} audio=${s.audioTrackId} sub=${s.subtitleTrackId}`,
          `video: ${f.video}`, `display: ${f.videoOut}`, `audio: ${f.audio}`, `output: ${f.audioOut}`,
          `prefs: ${JSON.stringify(s.outputPreferences)} style: ${JSON.stringify(s.subtitleStyle)}`];
        setLines(previous => {
          if (previous.join('\n') !== next.join('\n')) console.log('[apple-format]', JSON.stringify({ lines: next, format: s.format }));
          return next;
        });
      }}
      onCommand={event => console.log('[apple-format-command]', event.id, event.ok, event.failure?.message ?? '')}
      onError={error => console.log('[apple-format-error]', error.kind, error.message)} />}
    <View style={{ position: 'absolute', top: 30, left: 30, right: 30, backgroundColor: 'rgba(0,0,0,0.6)', padding: 12 }}>
      {lines.map(line => <Text key={line} style={{ color: 'white', fontSize: 22 }}>{line}</Text>)}
    </View>
  </View>;
}
AppRegistry.registerComponent('main', () => Probe);
