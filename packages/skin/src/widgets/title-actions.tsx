// Capability-backed title mutations shown on every built-in title surface.
import { msg, type TitleActions as Actions } from '@vela/core';
import { useVela } from '@vela/core/react';
import { useEffect, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FocusPressable } from '../focus';
import { useHost } from '../host';
import { holdBack } from '../menu-key';
import { useLook } from './common/look';
import type { TitleVersions, VersionItem } from '@vela/core';
import { versionAvailability, versionBadge, versionChips } from './versions';

export function VersionsControl() {
  const vela = useVela();
  const host = useHost();
  const look = useLook();
  const id = host.env.detail?.title[0]?.id ?? '';
  const [data, setData] = useState<TitleVersions | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { let live = true; setData(null); if (id) void vela.catalogue.titleVersions(id).then(value => { if (live) setData(value); }).catch(() => {}); return () => { live = false; }; }, [vela, id]);
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    return holdBack(() => { setOpen(false); return true; });
  }, [open]);
  if (!data?.versions.length) return null;
  const current = data.versions.find(version => version.id === data.selectedVersionId) ?? data.versions[0]!;
  const badge = versionBadge(current);
  const play = (version: VersionItem, index: number) => {
    setOpen(false);
    host.dispatch('play', `${id}||||${index === 0 ? '' : version.id}`);
  };
  const automatic = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { setData(await vela.catalogue.clearVersionChoice(id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not clear your choice'); }
    finally { setBusy(false); }
  };
  return <>
    <VersionButton label={`Versions, ${current.label}`} text="Versions" detail={current.label} badge={badge} run={() => setOpen(true)} />
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.ui.scrim, justifyContent: 'center', alignItems: 'center', padding: 16 }]}>
        <ScrollView testID="versions-sheet" style={{ maxHeight: '88%', width: 680, maxWidth: '100%', backgroundColor: look.ui.page, borderRadius: 24 }} contentContainerStyle={{ padding: 24, gap: 12 }}>
          <Text style={look.text({ 'font-size': '28px', 'font-weight': '700' })}>Versions</Text>
          <Text style={look.text({ 'font-size': '15px', color: '$ui.inkSecondary' })}>Choose the original you want to play. Converted quality options remain available in the player.</Text>
          {data.rememberedChoice?.scope === 'show' ? <Text style={look.text({ 'font-size': '15px', 'font-weight': '600' })}>Your choice for this show: {data.rememberedChoice.label}</Text> : null}
          {data.versions.map((version, index) => <VersionRow key={version.id} version={version} selected={version.id === data.selectedVersionId} disabled={busy} run={() => play(version, index)} />)}
          {data.rememberedChoice ? <VersionButton label="Use automatic" detail="Clear your remembered choice" run={() => void automatic()} disabled={busy} /> : null}
          {error ? <Text accessibilityRole="alert" style={look.text({ color: '$ui.live' })}>{error}</Text> : null}
          <VersionButton label="Close" run={() => setOpen(false)} disabled={busy} />
        </ScrollView>
      </View>
    </Modal>
  </>;
}

function VersionRow({ version, selected, disabled, run }: { version: VersionItem; selected: boolean; disabled: boolean; run(): void }) {
  const look = useLook();
  const unavailable = version.availability === 'unavailable';
  const badge = versionBadge(version);
  const chips = versionChips(version);
  return <FocusPressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: disabled || unavailable }} accessibilityLabel={`${version.label}. ${versionAvailability(version)}`}
    disabled={disabled || unavailable} onPress={run} style={{ padding: 16, gap: 8, borderRadius: 16, borderWidth: selected ? 2 : 1, borderColor: selected ? look.ui.ink : look.ui.control, backgroundColor: look.ui.control, opacity: unavailable ? 0.45 : 1 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
      <Text style={look.text({ 'font-size': '18px', 'font-weight': '700' })}>{version.label}</Text>
      {badge ? <Text style={look.text({ 'font-size': '12px', 'font-weight': '700' })}>{badge}</Text> : null}
    </View>
    {chips.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{chips.map(chip => <Text key={chip} style={[look.text({ 'font-size': '12px' }), { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: look.ui.page }]}>{chip}</Text>)}</View> : null}
    <Text style={look.text({ 'font-size': '13px', color: '$ui.inkSecondary' })}>{versionAvailability(version)}</Text>
  </FocusPressable>;
}

function VersionButton({ label, text, detail, badge, run, disabled }: { label: string; text?: string; detail?: string; badge?: string; run(): void; disabled?: boolean }) {
  const look = useLook();
  const [focus, setFocus] = useState(false);
  return <FocusPressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled}
    onPress={run} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
    style={{ padding: 16, borderRadius: 12, backgroundColor: focus ? look.ui.ink : look.ui.control, opacity: disabled ? 0.5 : 1 }}>
    <View style={{ gap: 2 }}><Text style={look.text({ 'font-size': '18px', 'font-weight': '600', color: focus ? '$ui.inkInverse' : '$ui.ink' })}>{text ?? label}</Text>
    {detail ? <Text numberOfLines={1} style={look.text({ 'font-size': '12px', color: focus ? '$ui.inkInverse' : '$ui.inkSecondary' })}>{detail}{badge ? ` · ${badge}` : ''}</Text> : null}</View>
  </FocusPressable>;
}

export function TitleActions() {
  const vela = useVela();
  const host = useHost();
  const look = useLook();
  const id = host.env.detail?.title[0]?.id ?? '';
  const [actions, setActions] = useState<Actions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setActions(null);
    if (id) void vela.catalogue.titleActions(id).then(value => { if (live) setActions(value); }).catch(() => {});
    return () => { live = false; };
  }, [vela, id]);
  if (!actions || (!actions.watched && !actions.favorite && !actions.watchlist)) return null;

  const change = async (value: { played?: boolean; favorite?: boolean; watchlisted?: boolean }) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await vela.catalogue.setTitleWatch(id, value);
      setActions(await vela.catalogue.titleActions(id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : msg('cardMenu.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ alignItems: 'flex-end', maxWidth: '100%' }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 4 }}>
        {actions.watched ? <ActionButton disabled={busy} label={msg(actions.watch.played ? 'cardMenu.markUnwatched' : 'cardMenu.markWatched')} run={() => void change({ played: !actions.watch.played })} /> : null}
        {actions.favorite ? <ActionButton disabled={busy} label={msg(actions.watch.favorite ? 'cardMenu.removeFavourite' : 'cardMenu.addFavourite')} run={() => void change({ favorite: !actions.watch.favorite })} /> : null}
        {actions.watchlist ? <ActionButton disabled={busy} label={msg(actions.watch.watchlisted ? 'cardMenu.removeWatchlist' : 'cardMenu.addWatchlist')} run={() => void change({ watchlisted: !actions.watch.watchlisted })} /> : null}
      </ScrollView>
      {error ? <Text accessibilityRole="alert" style={look.text({ 'font-size': '13px', color: '$ui.accent' })}>{error}</Text> : null}
    </View>
  );
}

function ActionButton({ label, run, disabled }: { label: string; run(): void; disabled: boolean }) {
  const look = useLook();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pressed, setPressed] = useState(false);
  const lit = hover || focus;
  return (
    <FocusPressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
      disabled={disabled} onPress={run}
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
      style={[
        look.box({
          'min-height': '40px', padding: '8px 14px', 'justify-content': 'center',
          'border-radius': '9999px', 'background-color': lit ? '$ui.controlHover' : '$ui.control',
          border: focus ? '1px solid $ui.accent' : '1px solid $ui.glassEdge',
          'backdrop-filter': 'blur(16px)',
        }),
        pressed ? { opacity: 0.7, transform: [{ scale: 0.985 }] } : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      <Text style={look.text({ 'font-size': '13px', 'font-weight': lit ? '650' : '500' })}>{label}</Text>
    </FocusPressable>
  );
}
