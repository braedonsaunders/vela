// One auth flow for every host. The core reducer owns navigation; existing session actions own
// password, code, Plex exchange, restoration and handoff, without exposing credentials to skins.
// Each page is a step on the stage (step.tsx): the steps dissolve into each other, the horizon
// makes room for each, and the Back control lives in the stage's corner.
import { useEffect, useReducer, useRef, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { authFlow, initialAuthFlow, selectedAuthFlow, type AuthFlow } from '@vela/core';
import { holdBack } from '../../../menu-key';
import { Alert, CodeTiles, Pill, Waiting, Words } from '../../common/controls';
import { useLook } from '../../common/look';
import { SAIL_DRAWN_MS, Wordmark, WORDMARK_ASPECT } from '../sail';
import { useStage } from '../stage';
import { Rise, StepFrame, Steps, useStepIndex } from '../step';
import type { AuthActions, SessionAuth } from '../signed-out';
import { AddressStep, foundName } from './address';
import { Credentials } from './credentials';
import type { ServerActions, ServerProbe, ServersView } from './model';
import { PlexStep } from './plex';
import { Reconnecting } from './reconnecting';
import { ServerRow } from './server-row';
import { plexDetail, stepCopy, stepDirection, stepKey } from './steps';
import { TextAction } from './text-action';

export interface ConnectProps {
  servers: ServersView;
  actions: ServerActions;
  serverId?: string;
  onClose?(): void;
  onDownloads?(): void;
  auth?: SessionAuth;
  authActions?: AuthActions;
  /** Owner-facing identity for the selected server. Its technical record name remains internal. */
  brandingName?: string;
  /** This route is already the sign-in destination, with no server chooser behind it. */
  standaloneSignIn?: boolean;
  /** Open on Sign in with Plex, the server list behind it: a linked Plex server's account linked again. */
  plexLink?: boolean;
}

export function Connect({ servers, actions, onClose, onDownloads, auth, authActions, serverId = '', brandingName, standaloneSignIn = false, plexLink = false }: ConnectProps) {
  const stage = useStage();
  const layout = stage?.layout;
  useEffect(() => () => authActions?.cancelPlex(), [authActions]);
  const [flow, send] = useReducer(authFlow, servers.list.length, (count): AuthFlow => serverId
    ? selectedAuthFlow(serverId, count, !standaloneSignIn)
    : plexLink ? { step: { page: 'plex' }, history: [initialAuthFlow(count).step] } : initialAuthFlow(count));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [added, setAdded] = useState<{id: string; name: string; kind: string} | null>(null);
  const step = flow.step;
  const target = 'serverId' in step ? step.serverId : '';
  const record = servers.list.find(s => s.id === target) ?? (added?.id === target ? added : undefined);
  const kind = record?.kind ?? auth?.serverKind;
  const branded = !!brandingName && (target === servers.selectedId || target === auth?.serverId);
  const name = branded ? brandingName! : record?.name || 'server';
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
  const backRef = useRef(back);
  backRef.current = back;
  const canGoBack = !!flow.history.length || !!onClose;
  const backLabel = flow.history.length ? 'Back' : 'Cancel';
  useEffect(() => {
    stage?.setBack(canGoBack ? { label: backLabel, onPress: () => backRef.current() } : null);
  }, [canGoBack, backLabel]);
  useEffect(() => () => stage?.setBack(null), []);
  useEffect(() => {
    if (!flow.history.length && !onClose) return;
    const release = holdBack(() => { back(); return true; });
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
  // Opened to link Plex again: ask for a code at once, as Sign in with Plex does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (plexLink) void run(() => actions.plexStart()); }, []);
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
    const result = await actions.add(found.kind, foundName(found), found.normalizedUrl, found.machineIdentifier);
    if (result.error) return result;
    setAdded({id: result.id, name: foundName(found), kind: found.kind});
    const selected = await actions.select(result.id);
    if (!selected.error) send({ type: 'server', serverId: result.id });
    return selected;
  });
  const startPlex = () => { send({type: 'plex'}); void run(() => actions.plexStart()); };
  const quick = target === auth?.serverId ? auth.quick : servers.jellyfinQuick?.serverId === target ? servers.jellyfinQuick : null;
  useEffect(() => {
    if (auth?.quick && step.page === 'signin' && target === auth.serverId) send({type: 'code'});
  }, [auth?.quick, step.page, target]);
  const offline = step.page === 'signin' && target === auth?.serverId && auth?.phase === 'offline';
  const savedOffline = offline && !!auth.viewerId;
  const connecting = step.page === 'signin' && (auth?.phase === 'starting' || auth?.phase === 'redeeming') && target === auth?.serverId;
  const plexPage = step.page === 'plex' || step.page === 'server-plex' || (step.page === 'signin' && kind === 'plex' && !offline);
  const plexLinkState = step.page === 'server-plex' ? auth?.plex ?? null : servers.plex;
  const detail = plexPage ? plexDetail(plexLinkState, busy && !plexLinkState) : offline ? 'offline' : connecting ? 'connecting' : '';
  const key = stepKey(step, detail);
  // The way the flow moved, kept until the next step so a re-render does not flip it.
  const depth = useRef({ key, history: flow.history.length, direction: 'forward' as ReturnType<typeof stepDirection> });
  if (depth.current.key !== key) depth.current = { key, history: flow.history.length, direction: stepDirection(depth.current.history, flow.history.length) };
  const copy = stepCopy({ page: plexPage && step.page === 'signin' ? 'plex' : step.page, first: !flow.history.length && !onClose, name, savedOffline, plex: detail });
  // Fabric ignores the no-common-ligatures font variant. Non-joiners keep the ffl glyphs distinct.
  const title = savedOffline ? copy.title.replace('ffl', 'f‌f‌l') : copy.title;
  const titleLabel = savedOffline ? copy.title : undefined;
  const waiting = (plexPage && (detail === 'link' || (detail === 'servers' && !plexLinkState?.choices.length)))
    || (step.page === 'code' && quick?.status !== 'expired' && quick?.status !== 'denied') || connecting || (offline && !savedOffline);
  useEffect(() => { stage?.setWaiting(!!waiting); }, [waiting]);
  useEffect(() => { stage?.setDeep(flow.history.length > 0 || plexPage || step.page === 'code'); }, [flow.history.length, plexPage, step.page]);
  useEffect(() => () => stage?.setWaiting(false), []);
  const controlHeight = layout?.controlHeight ?? 56;
  const serverPlex = step.page === 'signin' && target === auth?.serverId && auth.plexAvailable
    ? <Pill primary={!auth.passwordAvailable} label="Sign in with Plex" testID="server-plex" height={controlHeight} disabled={busy} onPress={() => { send({type: 'server-plex'}); void run(() => authActions!.startPlex()); }}><PlexMark /></Pill>
    : null;
  const failure = error || (step.page === 'signin' && auth?.phase !== 'offline' && auth?.error) || '';
  const extras = <>
    {auth?.secureOrigin && step.page === 'signin' ? <Pill label="Use secure connection" height={48} onPress={() => void run(async () => { const result = await authActions?.secureSwitch(); if (result?.error) return result; if (result?.url) { if (Platform.OS === 'web') window.location.assign(result.url); else await Linking.openURL(result.url); } })} /> : null}
    {note && step.page === 'signin' ? <Words rows={{ 'font-size': '14px', color: '$ui.inkSecondary' }} style={{ textAlign: 'center' }}>{note}</Words> : null}
    {failure ? <Alert>{failure}</Alert> : null}
  </>;

  let page;
  if (step.page === 'add') {
    const first = copy.title === 'Vela' && !brandingName;
    page = <StepFrame align="low"
      heading={first ? <WelcomeMark /> : undefined}
      title={first ? undefined : brandingName && !flow.history.length ? brandingName : copy.title}
      subtitle={copy.subtitle}
      actions={<>
        <Pill primary label="Continue with Plex" testID="connect-plex" height={controlHeight} disabled={busy} onPress={startPlex}><PlexMark /></Pill>
        <Pill label="Enter a server address" testID="connect-address-open" height={controlHeight} disabled={busy} onPress={() => send({type: 'address'})} />
        {onDownloads ? <TextAction label="Open Downloads" testID="welcome-downloads" onPress={onDownloads} /> : null}
      </>}
    />;
  } else if (step.page === 'address') {
    page = <StepFrame title={copy.title} subtitle={copy.subtitle}
      body={<AddressStep servers={[]} busy={busy} probe={url => actions.probe(url)} onAdd={add} onSelect={select} onRemove={id => void run(() => actions.remove(id))} error={error} />} />;
  } else if (step.page === 'choose') {
    page = <StepFrame title={copy.title} subtitle={copy.subtitle}
      body={<ServerList servers={servers} brandingName={brandingName} busy={busy} onSelect={select} onRemove={id => void run(() => actions.remove(id))} />}
      actions={<Pill label="Add a server" testID="auth-add" height={controlHeight} onPress={() => send({type: 'add'})} />} />;
  } else if (step.page === 'server-plex') {
    page = <PlexStep title={copy.title} subtitle={copy.subtitle} link={auth?.plex ?? null} busy={busy} starting={busy && !auth?.plex} error={auth?.error ?? ''} onStart={() => void run(() => authActions!.startPlex())} onChoose={() => {}} onChooseProfile={(id, pin) => void run(() => authActions!.choosePlexProfile(id, pin))} onCancel={back} />;
  } else if (offline) {
    page = <StepFrame title={title} subtitle={savedOffline ? '' : `Reconnecting to ${name}`}
      body={<Reconnecting name={name} auth={auth!} busy={busy} onDownloads={onDownloads} onRetry={() => void run(() => authActions?.retry?.() ?? Promise.resolve())} onSignInAgain={authActions?.signInAgain ? () => void run(() => authActions.signInAgain!()) : undefined} />} />;
    if (titleLabel) page = <View accessibilityLabel={titleLabel} style={{ flexGrow: 1 }}>{page}</View>;
  } else if (plexPage) {
    page = <PlexStep title={copy.title} subtitle={copy.subtitle} link={servers.plex} busy={busy} starting={busy && !servers.plex} error={error} onStart={() => void run(() => actions.plexStart())} onChoose={id => void run(async () => { const result = await actions.plexChoose(id); if (!result.error && result.id) { setNote(result.note ?? ''); setAdded({id: result.id, name: 'server', kind: result.note ? 'ether' : 'plex'}); send({type: 'server', serverId: result.id}); } return result; })} onChooseProfile={(id, pin) => void run(() => actions.plexChooseProfile(id, pin))} onCancel={back} />;
  } else if (step.page === 'code') {
    const ended = quick?.status === 'expired' || quick?.status === 'denied';
    page = <StepFrame title={copy.title} align="centre" subtitle={quick?.code ? 'Open Quick Connect on a signed-in\ndevice and enter this code.' : ''}
      body={<View style={{ gap: layout?.gap ?? 16, alignItems: 'center' }}>
        <Rise index={2} style={{ width: '100%' }}>{quick?.code ? <CodeTiles code={quick.code} testID="connect-code" large /> : <Waiting>Requesting a code…</Waiting>}</Rise>
        {ended ? <Alert>{quick!.status === 'expired' ? 'Code expired. Go back to request another.' : 'Code rejected. Try again.'}</Alert> : quick?.code ? <Rise index={3}><Waiting>Waiting for approval…</Waiting></Rise> : null}
        {quick?.expiresLabel ? <Words rows={{ 'font-size': '13px', color: '$ui.inkQuiet' }}>{`Code expires at ${quick.expiresLabel}.`}</Words> : null}
      </View>} />;
  } else if (connecting) {
    page = <StepFrame title={copy.title} align="centre" body={<Rise index={1} style={{ alignItems: 'center' }}><Waiting>{auth!.phase === 'redeeming' ? `Signing in to ${name}…` : `Connecting to ${name}…`}</Waiting></Rise>} />;
  } else if (target === auth?.serverId && auth.plexAvailable && !auth.passwordAvailable && !auth.quickAvailable) {
    page = <StepFrame title={copy.title} body={extras} actions={serverPlex} />;
  } else {
    page = <StepFrame title={copy.title} body={<>
      <Credentials secondary={serverPlex} busy={busy} canPassword={target === auth?.serverId ? auth.passwordAvailable : true} canQuick={target === auth?.serverId ? auth.quickAvailable : true} compact={layout?.landscape || layout?.minimal}
        onSignIn={(username, password) => void run(() => kind === 'ether' && authActions ? authActions.signIn(username, password) : actions.jellyfinSignIn(target, username, password))}
        onQuick={() => void run(async () => { if (kind === 'ether' && authActions) await authActions.startQuick(); else await actions.jellyfinQuickStart(target); send({type: 'code'}); })} />
      {extras}
    </>} />;
  }
  return <Steps id={key} direction={depth.current.direction}>{page}</Steps>;
}

/** The first screen's heading: "vela", written in after the sail has drawn. */
function WelcomeMark() {
  const stage = useStage();
  const look = useLook();
  const height = stage?.layout.compact ? 44 : 52;
  return <View accessible accessibilityRole="header" accessibilityLabel="Vela" style={{ height, width: height * WORDMARK_ASPECT }}>
    <Wordmark height={height} write={!look.still} delay={stage?.first ? SAIL_DRAWN_MS - 700 : 120} colour={look.ui.ink} />
  </View>;
}

function ServerList({ servers, brandingName, busy, onSelect, onRemove }: { servers: ServersView; brandingName?: string; busy: boolean; onSelect(id: string): void; onRemove(id: string): void }) {
  const from = useStepIndex();
  return <View style={{ gap: 10 }}>
    {servers.list.map((server, i) => (
      <Rise key={server.id} index={from + i}>
        <ServerRow server={server.selected && brandingName ? { ...server, name: brandingName } : server} busy={busy} onSelect={onSelect} onRemove={onRemove} />
      </Rise>
    ))}
  </View>;
}

/** Plex's familiar gold chevron, decorative because the button already has a complete label. */
export function PlexMark() {
  return <Svg width={17} height={22} viewBox="0 0 17 22">
    <Path fill="#E5A00D" d="M0 0h6.2L17 11 6.2 22H0l10.8-11z" />
  </Svg>;
}
