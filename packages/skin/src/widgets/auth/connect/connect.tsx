// One auth flow for every host. The core reducer owns navigation; existing session actions own
// password, code, Plex exchange, restoration and handoff, without exposing credentials to skins.
import { useEffect, useReducer, useState } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';
import { authFlow, initialAuthFlow, type AuthFlow } from '@vela/core';
import { holdBack } from '../../../menu-key';
import { Alert, CodeTiles, Heading, Pill, Waiting, Words } from '../../common/controls';
import { useAuthLayout } from '../layout-context';
import type { AuthActions, SessionAuth } from '../signed-out';
import { AddressStep, foundName } from './address';
import { Credentials } from './credentials';
import type { ServerActions, ServerProbe, ServersView } from './model';
import { PlexStep } from './plex';
import { ServerRow } from './server-row';

export interface ConnectProps {
  servers: ServersView;
  actions: ServerActions;
  serverId?: string;
  onClose?(): void;
  auth?: SessionAuth;
  authActions?: AuthActions;
}

export function Connect({ servers, actions, onClose, auth, authActions, serverId = '' }: ConnectProps) {
  const layout = useAuthLayout();
  useEffect(() => () => authActions?.cancelPlex(), [authActions]);
  const [flow, send] = useReducer(authFlow, servers.list.length, (count): AuthFlow => serverId ? { step: {page: 'signin', serverId}, history: count ? [{page: 'choose'}] : [{page: 'add'}] } : initialAuthFlow(count));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [added, setAdded] = useState<{id: string; name: string; kind: string} | null>(null);
  const step = flow.step;
  const target = 'serverId' in step ? step.serverId : '';
  const record = servers.list.find(s => s.id === target) ?? (added?.id === target ? added : undefined);
  const kind = record?.kind ?? auth?.serverKind;
  const name = record?.name || 'server';
  useEffect(() => { if (serverId) send({type: 'server', serverId}); }, [serverId]);
  useEffect(() => { send({ type: 'servers', count: servers.list.length }); }, [servers.list.length]);
  useEffect(() => { if (auth?.phase === 'signed-in' && (step.page === 'signin' || step.page === 'code')) onClose?.(); }, [auth?.phase, step.page, onClose]);
  const back = () => {
    setError(''); setNote('');
    if (step.page === 'server-plex') authActions?.cancelPlex();
    if (step.page === 'code') { void authActions?.cancelQuick(); actions.jellyfinQuickCancel(); }
    if (step.page === 'plex' || kind === 'plex') actions.plexCancel();
    if (flow.history.length) send({ type: 'back' });
    else onClose?.();
  };
  useEffect(() => {
    const release = holdBack(() => { if (!flow.history.length && !onClose) return false; back(); return true; });
    if (Platform.OS !== 'web') return release;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); back(); } };
    window.addEventListener('keydown', key);
    return () => { release(); window.removeEventListener('keydown', key); };
  }, [flow, kind, authActions, actions, onClose]);
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { const result = await work() as {error?: string} | undefined; if (result?.error) setError(result.error); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not connect. Try again.'); }
    finally { setBusy(false); }
  };
  const select = (id: string) => void run(async () => {
    setNote('');
    const result = await actions.select(id);
    if (!result.error) {
      if (!auth && servers.list.find(server => server.id === id)?.status === 'ready') onClose?.();
      send({ type: 'server', serverId: id });
    }
    return result;
  });
  const add = (found: ServerProbe) => void run(async () => {
    const result = await actions.add(found.kind, foundName(found), found.normalizedUrl);
    if (result.error) return result;
    setAdded({id: result.id, name: foundName(found), kind: found.kind});
    const selected = await actions.select(result.id);
    if (!selected.error) send({ type: 'server', serverId: result.id });
    return selected;
  });
  const quick = target === auth?.serverId ? auth.quick : servers.jellyfinQuick?.serverId === target ? servers.jellyfinQuick : null;
  useEffect(() => {
    if (auth?.quick && step.page === 'signin' && target === auth.serverId) send({type: 'code'});
  }, [auth?.quick, step.page, target]);
  const title = step.page === 'choose' ? 'Choose a server' : step.page === 'add' ? 'Add a server' : step.page === 'plex' || step.page === 'server-plex' ? 'Sign in with Plex' : step.page === 'code' ? 'Use a code' : `Sign in to ${name}`;
  return <View style={{ gap: layout?.gap ?? 20, minHeight: 0, flexShrink: 1 }}>
    <View style={{ gap: layout?.tight ? 4 : 12 }}>
      {flow.history.length || onClose ? <Pill label={flow.history.length ? 'Back' : 'Cancel'} height={44} align="flex-start" onPress={back} testID="auth-back" /> : null}
      {!layout?.minimal ? <Heading title={title} /> : null}
    </View>
    {step.page === 'choose' ? <>
      <Pill label="Add a server" height={44} onPress={() => send({type: 'add'})} testID="auth-add" />
      <ScrollView style={{ flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
        {servers.list.map(server => <ServerRow key={server.id} server={server} busy={busy} onSelect={select} onRemove={id => void run(() => actions.remove(id))} />)}
      </ScrollView>
    </> : step.page === 'add' ? <AddressStep servers={[]} busy={busy} probe={url => actions.probe(url)} onAdd={add} onSelect={select} onRemove={id => void run(() => actions.remove(id))} onPlex={() => { send({type: 'plex'}); void run(() => actions.plexStart()); }} error="" />
    : step.page === 'server-plex' ? <PlexStep link={auth?.plex ?? null} busy={busy} starting={busy && !auth?.plex} error={auth?.error ?? ''} onStart={() => void run(() => authActions!.startPlex())} onChoose={() => {}} onCancel={back} />
    : step.page === 'plex' || kind === 'plex' ? <PlexStep link={servers.plex} busy={busy} starting={busy && !servers.plex} error="" onStart={() => void run(() => actions.plexStart())} onChoose={id => void run(async () => { const result = await actions.plexChoose(id); if (!result.error && result.id) { setNote(result.note ?? ''); setAdded({id: result.id, name: 'server', kind: result.note ? 'ether' : 'plex'}); send({type: 'server', serverId: result.id}); } return result; })} onCancel={back} />
    : step.page === 'code' ? <View style={{ gap: layout?.gap ?? 18, alignItems: 'center' }}>
      {quick?.code ? <CodeTiles code={quick.code} testID="connect-code" /> : <Waiting>Requesting a code…</Waiting>}
      {quick?.status === 'expired' || quick?.status === 'denied' ? <Alert>{quick.status === 'expired' ? 'Code expired. Go back to request another.' : 'Code rejected. Try again.'}</Alert> : <Waiting>Approve this code on a signed-in device.</Waiting>}
      {quick?.expiresLabel ? <Words rows={{ 'font-size': '12px', color: '$ui.inkQuiet' }}>{quick.expiresLabel}</Words> : null}
    </View> : auth?.phase === 'starting' || auth?.phase === 'redeeming' ? <Waiting>{auth.phase === 'redeeming' ? 'Signing in…' : 'Connecting…'}</Waiting>
    : auth?.phase === 'offline' ? <Alert>Cannot reach this server. Check the connection or choose another server.</Alert>
    : <Credentials busy={busy} canPassword={target === auth?.serverId ? auth.passwordAvailable : true} canQuick={target === auth?.serverId ? auth.quickAvailable : true} compact={layout?.landscape || layout?.minimal}
      onSignIn={(username, password) => void run(() => kind === 'ether' && authActions ? authActions.signIn(username, password) : actions.jellyfinSignIn(target, username, password))}
      onQuick={() => void run(async () => { if (kind === 'ether' && authActions) await authActions.startQuick(); else await actions.jellyfinQuickStart(target); send({type: 'code'}); })} />}
    {step.page === 'signin' && target === auth?.serverId && auth.plexAvailable ? <Pill label="Sign in with Plex" testID="server-plex" disabled={busy} onPress={() => { send({type: 'server-plex'}); void run(() => authActions!.startPlex()); }} /> : null}
    {auth?.secureOrigin && step.page === 'signin' ? <Pill label="Use secure connection" height={44} onPress={() => void run(async () => { const result = await authActions?.secureSwitch(); if (result?.error) return result; if (result?.url) { if (Platform.OS === 'web') window.location.assign(result.url); else await Linking.openURL(result.url); } })} /> : null}
    {note && step.page === 'signin' ? <Words rows={{ 'font-size': '13px', color: '$ui.inkSecondary' }}>{note}</Words> : null}
    {error || (step.page === 'signin' && auth?.error) ? <ScrollView style={{maxHeight: layout?.tight ? 56 : 120, flexShrink: 1}}><Alert>{error || auth?.error || ''}</Alert></ScrollView> : null}
  </View>;
}
