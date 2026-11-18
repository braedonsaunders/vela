// A shared capability-driven menu beside every skin's primary title action.
import { useEffect, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from 'react-native';
import { useVela } from '@vela/core/react';
import type { TitleActions as Actions } from '@vela/core';
import { FocusPressable } from '../focus';
import { useHost } from '../host';
import { holdBack } from '../menu-key';
import { useLook } from './common/look';
import { useFocusClaim } from './common/focus-claim';

export function TitleActions() {
  const vela = useVela();
  const host = useHost();
  const id = host.env.detail?.title[0]?.id ?? '';
  const look = useLook();
  const [actions, setActions] = useState<Actions | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { let live = true; setActions(null); if (id) void vela.catalogue.titleActions(id).then(a => { if (live) setActions(a); }).catch(() => {}); return () => { live = false; }; }, [vela, id]);
  useEffect(() => {
    if (!open) return;
    if (Platform.OS !== 'web') return holdBack(() => { setOpen(false); return true; });
    const back = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setOpen(false); } };
    document.addEventListener('keydown', back, true);
    return () => document.removeEventListener('keydown', back, true);
  }, [open]);
  if (!actions || (!actions.watched && !actions.list && actions.versions.length < 2)) return null;
  const change = async (value: { played?: boolean; listed?: boolean }) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await vela.catalogue.setTitleWatch(id, value); setActions(await vela.catalogue.titleActions(id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(false); }
  };
  const button = (label: string, run: () => void, key = label) => <ActionButton key={key} label={label} run={run} disabled={busy} preferred={label === (actions.watch.played ? 'Mark unwatched' : 'Mark watched')} />;
  const Trap = Platform.isTV ? TVFocusGuideView : View;
  return <>
    <ActionButton label="More actions" text="…" run={() => setOpen(true)} />
    <Modal visible={open} transparent onRequestClose={() => setOpen(false)}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.ui.scrim, justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <ScrollView style={{ maxHeight: '80%', width: 480, maxWidth: '100%', backgroundColor: look.ui.page, borderRadius: 20 }} contentContainerStyle={{ padding: 24, gap: 12 }}>
          <Text style={look.text({ 'font-size': '26px', 'font-weight': '700' })}>More actions</Text>
          <Trap {...(Platform.isTV ? { autoFocus: true, trapFocusUp: true, trapFocusDown: true, trapFocusLeft: true, trapFocusRight: true } : {})} style={{ gap: 12 }}>
          {actions.watched ? button(actions.watch.played ? 'Mark unwatched' : 'Mark watched', () => void change({ played: !actions.watch.played })) : null}
          {actions.list ? button(`${actions.watch.favorite || actions.watch.watchlisted ? 'Remove from' : 'Add to'} ${actions.list === 'favorite' ? 'favourites' : 'watchlist'}`, () => void change({ listed: !(actions.watch.favorite || actions.watch.watchlisted) })) : null}
          {actions.versions.length > 1 ? <Text style={look.text({ 'font-size': '18px' })}>Play version / language</Text> : null}
          {actions.versions.length > 1 ? actions.versions.map(v => button(v.name, () => { setOpen(false); host.dispatch('play', `${id}|${v.id}|${v.audioTrackId ?? ''}`); }, `${v.id}:${v.audioTrackId ?? ''}`)) : null}
          {error ? <Text accessibilityRole="alert" style={look.text({})}>{error}</Text> : null}
          {button('Close', () => setOpen(false))}
          </Trap>
        </ScrollView>
      </View>
    </Modal>
  </>;
}

function ActionButton({ label, text, run, disabled, preferred }: { label: string; text?: string; run(): void; disabled?: boolean; preferred?: boolean }) {
  const look = useLook();
  const [focus, setFocus] = useState(false);
  const claim = useFocusClaim(preferred);
  return <FocusPressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    hasTVPreferredFocus={claim} onPress={run} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
    style={{ padding: 16, borderRadius: 12, backgroundColor: focus ? look.ui.ink : look.ui.control, opacity: disabled ? 0.5 : 1 }}>
    <Text style={look.text({ 'font-size': text ? '24px' : '18px', 'font-weight': '600', color: focus ? '$ui.inkInverse' : '$ui.ink' })}>{text ?? label}</Text>
  </FocusPressable>;
}
