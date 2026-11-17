// Connect a server (the foundation's page, in every document's `ui` look): an address checked as
// it is typed, the server it found, then that kind's own sign-in. Plex links with a code at
// plex.tv/link; Jellyfin and Emby take a password or Quick Connect; an Ether server (in a standalone
// app) is selected and signs in on the app's own sign-in page. Your servers are listed to switch.
// A Plex account needs no address: Sign in with Plex links it and offers the account's servers.
// A signed-out Plex server's sign-in is this page too, and so is a standalone app's first start.
import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { msg } from '@vela/core';
import { Alert, Heading, Pill, Words } from '../../common/controls';
import { useLook } from '../../common/look';
import { AddressStep, foundName } from './address';
import { JellyfinStep } from './jellyfin';
import type { ServerActions, ServerProbe, ServersView } from './model';
import { usePending } from './pending';
import { PlexStep } from './plex';

export interface ConnectProps {
  servers: ServersView;
  actions: ServerActions;
  /** Open on this server's sign-in (a signed-out Plex server), or '' to start from an address. */
  serverId?: string;
  /** Leave without connecting (from the profile menu); absent on the signed-out page. */
  onClose?(): void;
}

// The store's server actions are methods: each is called on `actions`, never passed on detached.
export function Connect({ servers, actions, serverId = '', onClose }: ConnectProps) {
  const look = useLook();
  const { busy, run } = usePending();
  // Only a server added on this visit moves the page on to its sign-in.
  const [added, setAdded] = useState<{ id: string; kind: string; name: string } | null>(null);
  const [errors, setErrors] = useState({ add: '', server: '', plex: '', jellyfin: '' });
  const [dismissedEther, setDismissedEther] = useState('');
  const [plexAsked, setPlexAsked] = useState(false);
  // Signing in with a Plex account rather than a typed address (Plex servers are found through it).
  const [plexAccount, setPlexAccount] = useState(false);
  const fail = (key: keyof typeof errors, error: string) => setErrors(e => ({ ...e, [key]: error }));

  const target = serverId || added?.id || '';
  const record = servers.list.find(s => s.id === target);
  const kind = record?.kind ?? added?.kind ?? (plexAccount ? 'plex' : '');
  const name = record?.name ?? added?.name ?? '';

  const add = async (found: ServerProbe) => {
    fail('add', '');
    const outcome = await run(actions.add(found.kind, foundName(found), found.normalizedUrl));
    if (!outcome) return;
    if (outcome.error) fail('add', outcome.error);
    // An Ether server signs in on its own page: selecting it hands over to the app's sign-in.
    else if (found.kind === 'ether') await switchTo(outcome.id);
    else setAdded({ id: outcome.id, kind: found.kind, name: foundName(found) });
  };
  const switchTo = async (id: string) => {
    fail('server', '');
    const outcome = await run(actions.select(id));
    if (outcome?.error) fail('server', outcome.error);
  };
  const remove = async (id: string) => {
    fail('server', '');
    const outcome = await run(actions.remove(id));
    if (outcome?.error) fail('server', outcome.error);
  };
  const startPlex = async () => {
    fail('plex', '');
    setPlexAsked(true);
    try {
      await run(actions.plexStart());
    } finally {
      setPlexAsked(false);
    }
  };
  const signInWithPlex = () => {
    setPlexAccount(true);
    void startPlex();
  };
  const cancelPlex = () => {
    actions.plexCancel();
    setPlexAccount(false);
  };
  const choosePlex = async (id: string) => {
    fail('plex', '');
    const outcome = await run(actions.plexChoose(id));
    if (outcome?.error) fail('plex', outcome.error);
    else if (outcome?.id) setAdded({ id: outcome.id, kind: 'plex', name: '' });
  };
  const signIn = async (username: string, password: string) => {
    fail('jellyfin', '');
    const outcome = await run(actions.jellyfinSignIn(target, username, password));
    if (outcome?.error) fail('jellyfin', outcome.error);
  };
  const quick = servers.jellyfinQuick?.serverId === target ? servers.jellyfinQuick : null;

  return (
    <Animated.View style={[{ gap: 26 }, look.motion('velaEnter60')]}>
      {record?.etherOrigin && dismissedEther !== record.id ? (
        <View style={{ gap: 12 }}><Words rows={{ 'font-size': '14px' }}>This server is Ether. Connect with Ether for hero, people and library views</Words>
          <Pill label="Connect with Ether" testID="connect-with-ether" onPress={() => void (async () => { const result = await run(actions.add('ether', record.name, record.etherOrigin!)); if (result?.error) fail('add', result.error); else if (result) await switchTo(result.id); })()} />
          <Pill label="Not now" onPress={() => { setDismissedEther(record.id); if (record.kind === 'plex') void switchTo(record.id); }} />
        </View>
      ) : target === '' && !plexAccount ? (
        <AddressStep
          servers={servers.list}
          busy={busy}
          probe={url => actions.probe(url)}
          onAdd={add}
          onSelect={switchTo}
          onRemove={remove}
          onPlex={signInWithPlex}
          error={errors.add}
        />
      ) : (
        <>
          <Heading
            eyebrow={msg(kind === 'plex' ? 'connect.plex.eyebrow' : 'connect.signIn.eyebrow')}
            title={kind === 'plex' ? msg('connect.plex.title') : name}
          />
          {kind === 'plex' ? (
            <PlexStep
              link={servers.plex}
              busy={busy}
              starting={plexAsked && !servers.plex}
              error={errors.plex}
              onStart={startPlex}
              onChoose={choosePlex}
              onCancel={cancelPlex}
            />
          ) : (
            <JellyfinStep
              quick={quick}
              busy={busy}
              error={errors.jellyfin}
              onSignIn={signIn}
              onQuick={() => run(actions.jellyfinQuickStart(target))}
              onCancelQuick={() => actions.jellyfinQuickCancel()}
            />
          )}
        </>
      )}
      {plexAccount && target === '' && servers.plex?.state !== 'waiting' && !plexAsked ? (
        <Pill label={msg('connect.otherServer')} height={46} align="flex-start" onPress={cancelPlex} />
      ) : null}
      {errors.server ? <Alert>{errors.server}</Alert> : null}
      {onClose ? <Pill label={msg('ui.cancel')} height={46} align="flex-start" onPress={onClose} /> : null}
    </Animated.View>
  );
}
