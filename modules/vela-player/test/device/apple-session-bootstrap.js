// Test-only bootstrap for an owner-approved Quick Connect session. Private config
// stays beside the probe and is ignored. Restore mode restores the previous device
// identity and credentials before entering the regular application.
import React, { useEffect, useState } from 'react';
import { AppRegistry, Text, View, useTVEventHandler } from 'react-native';
import { Session } from '../../../../packages/core/src/store/session';
import { secrets } from '../../../../apps/vela/src/data/secrets';
import { config } from '../../../../apps/vela/src/data/config';
import privateConfig from './probe-config.json';

const backupKey = 'vela.apple-proof-backup';
const keys = ['vela.device', 'vela.session', 'vela.servers'];
if (privateConfig.restore) {
  const backup = JSON.parse(secrets.get(backupKey) || '{}');
  for (const key of keys) if (key in backup) secrets.set(key, backup[key] || '');
  if (!keys.every(key => !(key in backup) || secrets.get(key) === (backup[key] || ''))) {
    throw Error('Saved Vela state restoration failed');
  }
  secrets.set(backupKey, '');
  function Restored({ children }) {
    return React.createElement(View, { style: { flex: 1 } }, children,
      React.createElement(Text, { pointerEvents: 'none', style: { position: 'absolute', top: 35, left: 35, color: 'white', backgroundColor: '#000b', fontSize: 22, zIndex: 999999 } }, 'Original saved Vela state restored'));
  }
  AppRegistry.setWrapperComponentProvider(() => Restored);
} else {
  const backup = JSON.parse(secrets.get(backupKey) || '{}');
  for (const key of keys) if (!(key in backup)) backup[key] = secrets.get(key);
  secrets.set(backupKey, JSON.stringify(backup));
  const registry = JSON.parse(secrets.get('vela.servers') || '{"servers":[]}');
  secrets.set('vela.servers', JSON.stringify({ ...registry, selectedId: 'ether' }));
  if (secrets.get('vela.device') !== privateConfig.device.id) {
    secrets.set('vela.device', privateConfig.device.id);
    secrets.set('vela.session', JSON.stringify(privateConfig.tokens));
  }
  config.server = privateConfig.origin;
  config.user = '';
  config.password = '';
}
if (privateConfig.traceNetwork) {
  const messages = [`server ${config.server}`];
  const started = Date.now();
  let selected = '';
  const selectedConnection = Session.prototype.selected;
  Session.prototype.selected = function (...args) { const connection = selectedConnection.apply(this, args); selected = `${connection.record.kind} ${connection.record.origin}`; return connection; };
  const counts = { guide: 0, channels: 0 };
  const pages = new Set();
  const remoteEvents = [];
  function Overlay({ children }) {
    const [status, setStatus] = useState('');
    useTVEventHandler(event => {
      remoteEvents.push(`${event.eventType}:${event.tag ?? ''}:${event.eventKeyAction ?? ''}`);
      if (remoteEvents.length > 8) remoteEvents.shift();
    });
    useEffect(() => { const timer = setInterval(() => setStatus([`${selected} elapsed ${Math.floor((Date.now() - started) / 1000)}s guide ${counts.guide} channels ${counts.channels} unique guide pages ${pages.size}`, ...messages.slice(-2), remoteEvents.slice(-8).join(' ')].join('\n')), 500); return () => clearInterval(timer); }, []);
    return React.createElement(View, { style: { flex: 1 } }, children,
      React.createElement(Text, { pointerEvents: 'none', style: { position: 'absolute', top: 35, left: 35, color: 'white', backgroundColor: '#000b', fontSize: 22, zIndex: 999999 } }, status));
  }
  AppRegistry.setWrapperComponentProvider(() => Overlay);
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    let origin = 'unknown';
    try {
      const url = new URL(typeof input === 'string' ? input : input.url);
      origin = url.origin;
      if (url.pathname.endsWith('/live/guide')) { counts.guide++; pages.add(url.href); }
      if (url.pathname.endsWith('/live/channels')) counts.channels++;
    } catch {}
    try {
      const response = await nativeFetch(input, init);
      messages.push(`${origin} HTTP ${response.status}`);
      console.log('[apple-network]', origin, response.status);
      return response;
    } catch (error) {
      messages.push(`${origin} network error`);
      console.log('[apple-network]', origin, 'network-error');
      throw error;
    }
  };
  console.log('[apple-bootstrap-origin]', config.server);
}
require('expo-router/entry');
