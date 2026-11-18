import 'expo/src/Expo.fx';
// Test-only entry. Supply a private, gitignored probe-config.json beside this file,
// export with Expo export:embed, and swap into a signed device build for runtime QA.
// Never include the config or exported bundle in distribution artifacts.
import React, { useEffect, useRef, useState } from 'react';
import { AppRegistry, Text, View } from 'react-native';
import { VelaPlayer, VelaPlayerView } from '@vela/player';
import config from './probe-config.json';

const key = () => `${Date.now()}-${Math.random()}`;
async function call(path, body) {
  const response = await fetch(config.api + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}`, 'x-vela-device-id': config.deviceId },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw Error(`server ${response.status}`);
  return response.json();
}
function resolvedPlan(plan) {
  return { ...plan, paths: plan.paths.map(path => ({ ...path, ...(path.url ? { url: new URL(path.url, config.api).href } : {}) })) };
}
function Probe() {
  const [plan, setPlan] = useState(null);
  const lastLog = useRef(-10);
  const polling = useRef(null);
  const [status, setStatus] = useState('starting');
  useEffect(() => {
    (async () => {
      setStatus('negotiating lab session');
      const client = { device: config.device, protocolVersions: [0], ...await VelaPlayer.capabilities() };
      await call('/negotiate', { idempotencyKey: key(), client });
      setStatus('requesting lab playback plan');
      const plan = await call('/playback', { idempotencyKey: key(), titleId: config.titleId, client });
      VelaPlayer.setMediaAccess({ ...config.mediaAccess, headers: async () => config.mediaAccess.headers });
      await new Promise(resolve => setTimeout(resolve, 100));
      setPlan({ ...plan, paths: plan.paths.map(path => path.id === plan.selectedPathId ? {
        ...path, transport: 'file', original: true, url: config.refusedURL,
      } : path) });
    })().catch(error => setStatus(error.message));
    return () => clearInterval(polling.current);
  }, []);
  return <View style={{ flex: 1, backgroundColor: 'black' }}>
    {plan && <VelaPlayerView style={{ flex: 1 }} plan={plan}
      onSnapshot={snapshot => {
        setStatus(`${snapshot.state} ${Math.floor(snapshot.position || 0)} ${snapshot.backend || ''}`);
        if (snapshot.state === 'playing' && snapshot.position >= lastLog.current + 10) { lastLog.current = snapshot.position; console.log('[apple-recovery-proof]', snapshot.backend, Math.floor(snapshot.position || 0)); }
      }}
      onObservation={event => { void call(`/sessions/${event.sessionId}/observations`, event.observation).catch(() => {}); }}
      onError={error => { setStatus(error.message); console.log('[apple-recovery-error]', error.kind); }}
      onSessionCommand={async event => {
        try {
          console.log('[apple-recovery-command]', event.command.kind, event.command.pathId || '');
          const next = await call(`/sessions/${event.sessionId}/commands`, event.command);
          await VelaPlayer.setMediaAccess(null);
          setPlan(resolvedPlan(next));
          clearInterval(polling.current);
          polling.current = setInterval(() => {
            void call(`/sessions/${event.sessionId}`).then(snapshot => setPlan(resolvedPlan(snapshot.plan))).catch(() => {});
          }, 2000);
        } catch (error) { setStatus(error.message); }
      }} />}
    <Text style={{ color: 'white', fontSize: 28, position: 'absolute', bottom: 40, left: 40 }}>{status}</Text>
  </View>;
}
AppRegistry.registerComponent('main', () => Probe);
