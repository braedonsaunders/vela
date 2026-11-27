import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';
import { useHost } from '../../../host';
import { animation } from '../../../motion';
import { HORIZON_MOTION } from '../horizon-motion';
import { useAuthLayout } from '../layout-context';
import { Rise, StepFrame, useStepIndex } from '../step';
// Linking a Plex server: a PIN entered at plex.tv/link (one tile per character), then the
// account's servers to choose from, the recommended one marked. Only the chosen server's own
// token is kept (the session store's concern); this view only starts, chooses and cancels.
import { Linking, Platform, ScrollView, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { msg } from '@vela/core';
import {
  APressable,
  Alert,
  CodeTiles,
  Glyph,
  Label,
  NO_RING,
  overlaid,
  Pill,
  useInteraction,
  Waiting,
  Words,
} from '../../common/controls';
import { useLook } from '../../common/look';
import { useFocusClaim } from '../../common/focus-claim';
import type { PlexChoice, PlexLink } from './model';
import { nextProfilePin, profileGridColumns, profileInitials } from './plex-profile';
export { nextProfilePin, profileGridColumns, profileInitials } from './plex-profile';

export function PlexStep({
  title,
  subtitle,
  link,
  busy,
  starting,
  error,
  onStart,
  onChoose,
  onChooseProfile,
}: {
  title: string;
  subtitle: string;
  link: PlexLink | null;
  busy: boolean;
  /** A code was asked for and has not arrived yet. */
  starting: boolean;
  error: string;
  onStart(): void;
  onChoose(id: string): void;
  onChooseProfile?(id: string, pin?: string): void;
  onCancel(): void;
}) {
  const layout = useAuthLayout();
  const waiting = starting || link?.state === 'waiting';
  const failure = error ? <Alert>{error}</Alert> : null;
  if (waiting) {
    // The code is the page: large tiles over a pool of light, the address to enter it at, and
    // the horizon's light travelling while Plex is asked.
    return <StepFrame title={title} align="centre" body={<View style={{ gap: layout?.tight ? 14 : 22, alignItems: 'center' }}>
      <Rise index={2}>{link?.code ? <LinkLine url={link.linkUrl} /> : <Words rows={{ 'font-size': '17px', color: '$ui.inkSecondary' }}>Asking Plex for a code…</Words>}</Rise>
      <View style={{ width: '100%', alignItems: 'center' }}>
        <CodeGlow />
        {link?.code ? <CodeTiles code={link.code} testID="plex-code" large /> : <GhostTiles />}
      </View>
      <Rise index={4}><Waiting>{msg('connect.plex.waiting')}</Waiting></Rise>
      {failure}
    </View>} actions={link?.linkUrl && !Platform.isTV ? <Pill label="Open plex.tv/link" testID="plex-open-link" height={layout?.controlHeight ?? 56} onPress={() => void Linking.openURL(link.linkUrl)} /> : undefined} />;
  }
  if (link?.state === 'profiles') {
    return <StepFrame title={title} body={<><ProfilePicker labelled={false} profiles={link.profiles ?? []} busy={busy} onChoose={onChooseProfile ?? (() => {})} />{failure}</>} />;
  }
  if (link?.state === 'linked') {
    return <StepFrame title={title} subtitle={subtitle} body={<>
      {link.choices.length === 0 ? <FindingServers /> : <PlexChoices choices={link.choices} busy={busy} onChoose={onChoose} />}
      {failure}
    </>} />;
  }
  return <StepFrame title={title} subtitle={subtitle} body={<>
    {link?.state === 'expired' ? <Alert>{msg('connect.plex.expired')}</Alert> : null}
    {link?.state === 'failed' ? <Alert>{msg('connect.plex.failed')}</Alert> : null}
    {failure}
  </>} actions={<Pill primary label={msg('connect.plex.start')} onPress={onStart} disabled={busy} busy={busy} testID="plex-start" height={layout?.controlHeight ?? 56} />} />;
}

/** A pool of light under the code, breathing while it waits to be entered. */
function CodeGlow() {
  const look = useLook();
  const host = useHost();
  const preset = host.doc.motion.velaCodeGlow ?? HORIZON_MOTION.velaCodeGlow;
  return <Animated.View pointerEvents="none" style={[look.box({
    position: 'absolute', left: '-10%', right: '-10%', top: '30%', height: '120px',
    'background-image': 'radial-gradient(ellipse 50% 50% at 50% 50%, #e8a06355 0%, #e8a06300 100%)',
  }), animation(preset, host.doc.keyframes, look.still, 0) as ViewStyle]} />;
}

/** Where the code will be, before Plex has sent it. */
function GhostTiles() {
  const look = useLook();
  const host = useHost();
  const preset = host.doc.motion.velaGhostRow ?? HORIZON_MOTION.velaGhostRow;
  return <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center', width: '100%' }}>
    {[0, 1, 2, 3].map(i => <Animated.View key={i} style={[look.box({ flex: '1', 'max-width': '64px', height: '82px', 'border-radius': '18px', 'background-color': '$ui.control', border: '1px solid $ui.glassEdge' }),
      animation({ ...preset, delay: i * 140 }, host.doc.keyframes, look.still, 0) as ViewStyle]} />)}
  </View>;
}

/** Linked, the account's servers not listed yet: their places breathing on the water. */
function FindingServers() {
  const look = useLook();
  const host = useHost();
  const from = useStepIndex();
  const preset = host.doc.motion.velaGhostRow ?? HORIZON_MOTION.velaGhostRow;
  return <View style={{ gap: 10 }}>
    <Rise index={from} style={{ alignItems: 'center', paddingBottom: 4 }}><Waiting>{msg('connect.plex.finding')}</Waiting></Rise>
    {[0, 1].map(i => <Rise key={i} index={from + 1 + i}>
      <Animated.View style={[look.box({ height: '68px', 'border-radius': '18px', 'background-color': '$ui.control', border: '1px solid $ui.glassEdge', padding: '14px 18px', gap: '8px' }),
        animation({ ...preset, delay: i * 260 }, host.doc.keyframes, look.still, 0) as ViewStyle]}>
        <View style={look.box({ width: i ? '46%' : '58%', height: '14px', 'border-radius': '7px', 'background-color': '$ui.skeletonLight' })} />
        <View style={look.box({ width: i ? '30%' : '38%', height: '10px', 'border-radius': '5px', 'background-color': '$ui.skeleton' })} />
      </Animated.View>
    </Rise>)}
  </View>;
}

function PlexChoices({ choices, busy, onChoose }: { choices: PlexChoice[]; busy: boolean; onChoose(id: string): void }) {
  const from = useStepIndex();
  return <View style={{ gap: 10 }}>
    {choices.map((choice, i) => <Rise key={choice.id} index={from + i}><Choice choice={choice} busy={busy} onChoose={onChoose} /></Rise>)}
  </View>;
}

export function ProfilePicker({ profiles, busy, currentProfileId = '', onChoose, labelled = true }: { profiles: Profile[]; busy: boolean; currentProfileId?: string; onChoose(id: string, pin?: string): void; /** Its own WHO'S WATCHING? (a step titles it instead). */ labelled?: boolean }) {
  const width = useWindowDimensions().width;
  const [protectedId, setProtectedId] = useState('');
  const [pin, setPin] = useState('');
  const chosen = profiles.find(profile => profile.id === protectedId);
  const submit = () => { if (chosen && pin.length === 4 && !busy) onChoose(chosen.id, pin); };
  useEffect(() => {
    if (Platform.OS !== 'web' || !chosen) return;
    const key = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) { event.preventDefault(); setPin(value => nextProfilePin(value, event.key)); }
      else if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); setPin(value => nextProfilePin(value, 'delete')); }
      else if (event.key === 'Enter' && pin.length === 4) { event.preventDefault(); submit(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [chosen, pin, busy]);
  if (chosen) return <PinPad profile={chosen} pin={pin} busy={busy} onDigit={digit => setPin(value => nextProfilePin(value, digit))}
    onDelete={() => setPin(value => nextProfilePin(value, 'delete'))} onSubmit={submit}
    onBack={() => { setProtectedId(''); setPin(''); }} />;
  const columns = profileGridColumns(width);
  return <View style={{ gap: 12 }}>
    {labelled ? <Label>WHO’S WATCHING?</Label> : null}
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }} keyboardShouldPersistTaps="handled">
      {profiles.map(profile => <ProfileCard key={profile.id} profile={profile} columns={columns} disabled={busy}
        current={profile.id === currentProfileId} onPress={() => profile.protected ? setProtectedId(profile.id) : onChoose(profile.id)} />)}
    </ScrollView>
  </View>;
}

type Profile = { id: string; name: string; protected: boolean; avatarUrl?: string; restricted?: boolean };

function ProfileCard({ profile, columns, disabled, current, onPress }: { profile: Profile; columns: 2 | 3 | 4; disabled: boolean; current: boolean; onPress(): void }) {
  const look = useLook();
  const { state, handlers } = useInteraction();
  const preferred = useFocusClaim(current);
  const [failed, setFailed] = useState(false);
  const size = columns === 2 ? 82 : 76;
  const rows = overlaid({ padding: '7px 4px', 'border-radius': '16px', 'align-items': 'center', gap: '7px' }, state, {
    hover: { 'background-color': '$ui.controlHover' },
    focus: { 'background-color': '$ui.control', 'box-shadow': '0px 0px 0px 3px $ui.accent' },
  }, disabled);
  const marker = current ? 'Current' : profile.restricted ? (/kid/i.test(profile.name) ? 'Kids' : 'Restricted') : '';
  return <APressable accessibilityRole="button" accessibilityLabel={`${profile.name}${current ? ', current profile' : ''}${profile.protected ? ', PIN required' : ''}${marker ? `, ${marker}` : ''}`}
    accessibilityState={{ selected: current }} hasTVPreferredFocus={preferred}
    disabled={disabled} onPress={onPress} testID={`plex-profile-${profile.id}`} {...handlers}
    style={[look.box(rows), { width: `${Math.floor(100 / columns) - 2}%` }, NO_RING]}>
    <View style={{ width: size, height: size, marginBottom: 6 }}>
      <View style={[look.box({ width: `${size}px`, height: `${size}px`, 'border-radius': `${size / 2}px`, overflow: 'hidden', 'background-color': '$ui.controlHover', border: '2px solid $ui.glassEdgeStrong', 'align-items': 'center', 'justify-content': 'center' })]}>
        {profile.avatarUrl && !failed ? <Image source={{ uri: profile.avatarUrl }} contentFit="cover" style={{ width: size, height: size }} onError={() => setFailed(true)} accessibilityElementsHidden />
          : <Words rows={{ 'font-size': `${Math.round(size * .33)}px`, 'font-weight': '700', color: '$ui.accent' }}>{profileInitials(profile.name)}</Words>}
      </View>
      {profile.protected ? <View style={[look.box({ position: 'absolute', right: '-2px', bottom: '-2px', width: '26px', height: '26px', 'border-radius': '13px', 'background-color': '$ui.accent', border: '2px solid $ui.page', 'align-items': 'center', 'justify-content': 'center' })]}>
        <Glyph symbol="lock" size={14} color={look.ui.onAccent} />
      </View> : null}
      {/* Current, Kids or Restricted: a small tag on the avatar's lower edge, so the grid stays even. */}
      {marker ? <View style={{ position: 'absolute', left: -12, right: -12, bottom: -7, alignItems: 'center' }}>
        <View style={look.box({ padding: '2px 7px', 'border-radius': '999px', 'background-color': '$ui.raised', border: '1px solid $ui.glassEdgeStrong' })}>
          <Words rows={{ 'font-size': '10px', 'font-weight': '700', color: '$ui.inkSecondary', 'letter-spacing': '0.04em' }} maxScale={1.2}>{marker.toUpperCase()}</Words>
        </View>
      </View> : null}
    </View>
    <Words rows={{ 'font-size': '14px', 'font-weight': '650' }} lines={2} style={{ textAlign: 'center', minHeight: 34 }}>{profile.name}</Words>
  </APressable>;
}

function PinPad({ profile, pin, busy, onDigit, onDelete, onSubmit, onBack }: { profile: Profile; pin: string; busy: boolean; onDigit(value: string): void; onDelete(): void; onSubmit(): void; onBack(): void }) {
  const look = useLook();
  return <View style={{ gap: 12, alignItems: 'stretch' }}>
    <View style={{ alignItems: 'center', gap: 8 }}>
      <Label>{`ENTER ${profile.name.toUpperCase()}’S PLEX HOME PIN`}</Label>
      <View style={{ flexDirection: 'row', gap: 12 }} accessibilityLabel={`${pin.length} of 4 PIN digits entered`} accessibilityLiveRegion="polite">
        {[0, 1, 2, 3].map(index => <View key={index} style={look.box({ width: '16px', height: '16px', 'border-radius': '8px', border: '2px solid $ui.accent', 'background-color': index < pin.length ? '$ui.accent' : '#00000000' })} />)}
      </View>
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 270, alignSelf: 'center' }}>
      {['1','2','3','4','5','6','7','8','9'].map(digit => <PinKey key={digit} label={digit} disabled={busy || pin.length >= 4} onPress={() => onDigit(digit)} />)}
      <View style={{ width: 78, height: 48 }} />
      <PinKey label="0" disabled={busy || pin.length >= 4} onPress={() => onDigit('0')} />
      <PinKey label="⌫" accessibilityLabel="Delete PIN digit" disabled={busy || !pin} onPress={onDelete} />
    </View>
    <Pill primary label="Continue" disabled={busy || pin.length !== 4} busy={busy} onPress={onSubmit} testID="plex-profile-continue" />
    <Pill label="Choose another profile" disabled={busy} onPress={onBack} testID="plex-profile-back" />
  </View>;
}

function PinKey({ label, accessibilityLabel, disabled, onPress }: { label: string; accessibilityLabel?: string; disabled: boolean; onPress(): void }) {
  const look = useLook();
  const { state, handlers } = useInteraction();
  const rows = overlaid({ width: '78px', height: '48px', 'border-radius': '14px', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$ui.control', border: '1px solid $ui.glassEdge' }, state, {
    hover: { 'background-color': '$ui.controlHover' }, focus: { 'box-shadow': '0px 0px 0px 3px $ui.accent' },
  }, disabled);
  return <APressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} disabled={disabled} onPress={onPress}
    testID={`plex-pin-${label}`} style={[look.box(rows), state.pressed && { transform: [{ scale: .96 }] }, NO_RING]} {...handlers}>
    <Words rows={{ 'font-size': '20px', 'font-weight': '650' }}>{label}</Words>
  </APressable>;
}

/** "Enter this code at plex.tv/link": a link where a browser can open it, the address on a TV. */
function LinkLine({ url }: { url: string }) {
  const look = useLook();
  const { state, handlers } = useInteraction();
  const canOpen = !Platform.isTV;
  const rows = { 'font-size': '17px', 'font-weight': '650' };
  return (
    <View
      style={{ flexDirection: 'row', gap: 6, alignItems: 'baseline', justifyContent: 'center', flexWrap: 'wrap' }}
    >
      <Words rows={{ 'font-size': '17px', color: '$ui.inkSecondary' }}>{msg('connect.plex.enterAt')}</Words>
      {canOpen ? (
        <APressable
          onPress={Platform.OS === 'web' ? undefined : () => Linking.openURL(url)}
          accessibilityRole="link"
          {...(Platform.OS === 'web' ? { href: url, hrefAttrs: { target: '_blank', rel: 'noreferrer' } } : {})}
          testID="plex-link"
          {...handlers}
          style={[
            look.box(
              overlaid({ 'border-radius': '4px' }, state, { focus: { 'box-shadow': '0px 0px 0px 2px $ui.accent' } }),
            ),
            NO_RING,
          ]}
        >
          <Words rows={rows} style={{ textDecorationLine: 'underline' }}>
            {msg('connect.plex.linkLabel')}
          </Words>
        </APressable>
      ) : (
        <Words rows={rows}>{msg('connect.plex.linkLabel')}</Words>
      )}
    </View>
  );
}

function Choice({ choice, busy, onChoose }: { choice: PlexChoice; busy: boolean; onChoose(id: string): void }) {
  const look = useLook();
  const { state, handlers } = useInteraction();
  const rows = overlaid(
    {
      'min-height': '68px',
      padding: '12px 18px',
      'border-radius': '18px',
      border: '1px solid $ui.glassEdge',
      'background-color': '$ui.control',
      transition: 'background-color 180ms linear',
    },
    state,
    { hover: { 'background-color': '$ui.controlHover' }, focus: { 'box-shadow': '0px 0px 0px 2px $ui.accent' } },
    busy,
  );
  return (
    <APressable
      onPress={() => onChoose(choice.id)}
      disabled={busy}
      accessibilityRole="button"
      testID={`plex-server-${choice.id}`}
      style={[look.box(rows), { flexDirection: 'row', alignItems: 'center', gap: 12 }, NO_RING]}
      {...handlers}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Words rows={{ 'font-size': '17px', 'font-weight': '600' }} lines={1}>
          {choice.name}
        </Words>
        <Words rows={{ 'font-size': '13px', color: '$ui.inkQuiet' }} lines={1}>
          {choice.connectionLabel}
        </Words>
      </View>
      {choice.recommended ? (
        <View style={look.box({ padding: '4px 8px', 'border-radius': '6px', 'background-color': '$ui.accent' })}>
          <Words
            rows={{ 'font-size': '12px', 'font-weight': '650', 'letter-spacing': '0.06em', color: '$ui.onAccent' }}
            maxScale={1.15}
          >
            {msg('connect.plex.recommended')}
          </Words>
        </View>
      ) : null}
    </APressable>
  );
}
