import 'expo/src/Expo.fx';
// Device-only entry. Private config and compiled bundles belong in scratch and never distribution.
import React, { useEffect, useRef, useState } from 'react';
import { AppRegistry, Text, View } from 'react-native';
import { VelaPlayer, VelaPlayerView } from '@vela/player';
import config from './android-probe-config.json';

const key = () => `${Date.now()}-${Math.random()}`;
async function call(path, body) {
  const response = await fetch(config.api + path, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json',
      authorization: `Bearer ${config.token}`, 'x-vela-device-id': config.deviceId },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw Error(`lab HTTP ${response.status}`);
  return response.json();
}
function resolve(plan) {
  return { ...plan, paths: plan.paths.map(path => ({ ...path, ...(path.url ? { url: new URL(path.url, config.api).href } : {}) })) };
}
function Probe() {
  const [plan, setPlan] = useState(null);
  const [command, setCommand] = useState(null);
  const [status, setStatus] = useState('starting');
  const current = useRef(null);
  const last = useRef(-5);
  const timer = useRef(null);
  const commandId = useRef(0);
  const set = plan => { current.current = plan; setPlan(resolve(plan)); };
  useEffect(() => {
    let alive = true;
    (async () => {
      const client = { device: config.device, protocolVersions: [0], ...await VelaPlayer.capabilities() };
      if (!config.fixture) await call('/negotiate', { client, idempotencyKey: key() });
      const result = config.fixture || await call('/playback', { ...config.target, positionSeconds: 0, client, idempotencyKey: key() });
      if (!alive) return;
      await VelaPlayer.setMediaAccess({ origin: config.mediaOrigin || config.origin, pathPrefix: config.pathPrefix || '/', headers: async () => config.mediaHeaders || {} });
      if (config.refusedURL) {
        const converted = result.paths.find(path => path.kind === 'transcode' && ['ready', 'on-demand'].includes(path.readiness));
        result.paths = result.paths.filter(path => path.id === result.selectedPathId || path.id === converted?.id)
          .map(path => path.id === result.selectedPathId ? { ...path, original: true, transport: 'file', url: config.refusedURL } : path);
      }
      set(result);
      console.log('[android-proof-plan]', result.paths.find(path => path.id === result.selectedPathId)?.kind,
        result.audioTracks.map(track => track.codec).join(','), result.subtitleTracks.length);
      timer.current = setInterval(() => {
        const active = current.current;
        if (active && !config.fixture) void call(`/sessions/${active.sessionId}`).then(snapshot => {
          if (alive && snapshot.plan.revision > current.current.revision) set(snapshot.plan);
        }).catch(error => setStatus(error.message));
      }, 2000);
    })().catch(error => { setStatus(error.message); console.log('[android-proof-error]', error.message); });
    return () => { alive = false; clearInterval(timer.current); };
  }, []);
  useEffect(() => {
    // The harness changes config between runs; each check stops its server session and native view.
    const timeout = setTimeout(async () => {
      const active = current.current;
      if (active && !config.fixture) await call(`/sessions/${active.sessionId}/commands`, { kind: 'stop', idempotencyKey: key(),
        sourceGeneration: active.sourceGeneration, seekGeneration: active.seekGeneration }).catch(() => {});
      current.current = null; setPlan(null); clearInterval(timer.current);
      setStatus('Check stopped'); console.log('[android-proof-stopped]');
    }, config.durationMs || 60000);
    return () => clearTimeout(timeout);
  }, []);
  return <View style={{ flex: 1, backgroundColor: 'black' }}>
    {plan && <VelaPlayerView style={{ flex: 1 }} plan={plan} command={command}
      onSnapshot={snapshot => {
        setStatus(`${snapshot.state} ${Math.floor(snapshot.position || 0)} ${snapshot.backend || ''} ${snapshot.video?.dynamicRange || ''} audio=${snapshot.audioTrackId || ''} sub=${snapshot.subtitleTrackId || ''}`);
        if (snapshot.position >= last.current + 5) {
          last.current = snapshot.position;
          console.log('[android-proof]', snapshot.state, Math.floor(snapshot.position), snapshot.backend,
            snapshot.video?.codec, snapshot.video?.dynamicRange, snapshot.audioTrackId, snapshot.subtitleTrackId);
        }
      }}
      onObservation={event => { if (!config.fixture) void call(`/sessions/${event.sessionId}/observations`, event.observation).catch(() => {}); }}
      onError={error => { setStatus(error.message); console.log('[android-proof-error]', error.kind); }}
      onCommand={event => console.log('[android-proof-command]', event.id, event.ok)}
      onSessionCommand={async event => {
        try {
          console.log('[android-proof-recovery]', event.command.kind, event.command.pathId || '');
          set(await call(`/sessions/${event.sessionId}/commands`, event.command));
        } catch (error) { setStatus(error.message); }
      }} />}
    <Text style={{ position: 'absolute', top: 35, left: 15, color: 'white', backgroundColor: '#000b', fontSize: 16 }}>{status}</Text>
    {plan && <View style={{ position: 'absolute', bottom: 25, left: 15, flexDirection: 'row', gap: 15 }}>
      {plan.audioTracks.map(track => <Text key={track.id} style={{ color: 'white', padding: 10, backgroundColor: '#333' }}
        onPress={() => setCommand({ id: ++commandId.current, type: 'audio', trackId: track.id })}>{track.name}</Text>)}
      {plan.subtitleTracks.slice(0, 3).map(track => <Text key={track.id} style={{ color: 'white', padding: 10, backgroundColor: '#333' }}
        onPress={() => setCommand({ id: ++commandId.current, type: 'subtitle', trackId: track.id })}>{track.name}</Text>)}
      <Text style={{ color: 'white', padding: 10, backgroundColor: '#333' }} onPress={() => setCommand({ id: ++commandId.current, type: 'subtitle', trackId: null })}>Off</Text>
    </View>}
  </View>;
}
AppRegistry.registerComponent('main', () => Probe);
