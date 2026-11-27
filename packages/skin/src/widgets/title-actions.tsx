// Capability-backed title mutations shown on every built-in title surface.
import { downloadOfferReason, downloadPercent, isPlayableDownload, msg, type DownloadOffer, type TitleActions as Actions } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { useCallback, useEffect, useState, type ReactNode, type ComponentRef } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { FocusPressable } from '../focus';
import { useHost } from '../host';
import { holdBack } from '../menu-key';
import { useServerSwitch } from './auth/servers';
import Svg, { Circle } from 'react-native-svg';
import { Glyph } from './common/controls';
import { confirmAction } from './common/confirm';
import { SheetModal } from './common/sheet-modal';
import { useLook } from './common/look';
import type { TitleVersions, VersionItem } from '@vela/core';
import { versionAvailability, versionBadge, versionChips, versionPlayArg } from './versions';

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
  const play = (version: VersionItem) => {
    setOpen(false);
    host.dispatch('play', versionPlayArg(id, version));
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
    <SheetModal open={open} scrim={look.ui.scrim} still={look.still} onRequestClose={() => setOpen(false)}>
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', padding: 16 }]}>
        <ScrollView testID="versions-sheet" style={{ maxHeight: '88%', width: 680, maxWidth: '100%', backgroundColor: look.ui.page, borderRadius: 24 }} contentContainerStyle={{ padding: 24, gap: 12 }}>
          <Text style={look.text({ 'font-size': '28px', 'font-weight': '700' })}>Versions</Text>
          <Text style={look.text({ 'font-size': '15px', color: '$ui.inkSecondary' })}>Choose the original you want to play. Converted quality options remain available in the player.</Text>
          {data.rememberedChoice?.scope === 'show' ? <Text style={look.text({ 'font-size': '15px', 'font-weight': '600' })}>Your choice for this show: {data.rememberedChoice.label}</Text> : null}
          {data.versions.map(version => <VersionRow key={version.id} version={version} selected={version.id === data.selectedVersionId} disabled={busy} run={() => play(version)} />)}
          {data.rememberedChoice ? <VersionButton label="Use automatic" detail="Clear your remembered choice" run={() => void automatic()} disabled={busy} /> : null}
          {error ? <Text accessibilityRole="alert" style={look.text({ color: '$ui.live' })}>{error}</Text> : null}
          <VersionButton label="Close" run={() => setOpen(false)} disabled={busy} />
        </ScrollView>
      </View>
    </SheetModal>
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
  // A phone draws it at the compact scale: a 44pt-plus row, not a 70pt card.
  const compact = !!useHost().env.small && !Platform.isTV;
  const [focus, setFocus] = useState(false);
  return <FocusPressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled}
    onPress={run} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
    style={{ padding: compact ? 0 : 16, paddingVertical: compact ? 8 : 16, paddingHorizontal: compact ? 14 : 16, minHeight: compact ? 44 : undefined, justifyContent: 'center',
      borderRadius: 12, backgroundColor: focus ? look.ui.ink : look.ui.control, opacity: disabled ? 0.5 : 1 }}>
    <View style={{ gap: compact ? 1 : 2 }}><Text style={look.text({ 'font-size': compact ? '14px' : '18px', 'font-weight': '600', color: focus ? '$ui.inkInverse' : '$ui.ink' })}>{text ?? label}</Text>
    {detail ? <Text numberOfLines={1} style={look.text({ 'font-size': '12px', color: focus ? '$ui.inkInverse' : '$ui.inkSecondary' })}>{detail}{badge ? ` · ${badge}` : ''}</Text> : null}</View>
  </FocusPressable>;
}

export function TitleActions() {
  const vela = useVela();
  const host = useHost();
  const look = useLook();
  const title = host.env.detail?.title[0];
  const id = title?.id ?? '';
  const [actions, setActions] = useState<Actions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    let live = true;
    setActions(null);
    if (id) void vela.catalogue.titleActions(id).then(value => { if (live) setActions(value); }).catch(() => {});
    return () => { live = false; };
  }, [vela, id]);
  const hasWatchActions = !!actions && (actions.watched || actions.favorite || actions.watchlist);
  const supportsDownloads = useVelaState(state => state.downloads.supported);
  const downloadTitle = supportsDownloads && (title?.kind === 'movie' || title?.kind === 'episode');
  if (!title || (!hasWatchActions && !host.env.canPlaylists && !downloadTitle)) return null;

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
    <View style={{ alignItems: 'flex-start', maxWidth: '100%', gap: 4 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 2 }}>
        {actions?.watched ? <ActionButton testID="detail-watch-played" disabled={busy}
          icon={actions.watch.played ? 'check-circle' : 'checkmark'} active={actions.watch.played}
          label={msg(title?.kind === 'show'
            ? actions.watch.played ? 'cardMenu.markShowUnwatched' : 'cardMenu.markShowWatched'
            : actions.watch.played ? 'cardMenu.markUnwatched' : 'cardMenu.markWatched')}
          run={() => void change({ played: !actions.watch.played })} /> : null}
        {actions?.favorite ? <ActionButton testID="detail-watch-favourite" disabled={busy}
          icon={actions.watch.favorite ? 'heart-fill' : 'heart'} active={actions.watch.favorite}
          label={msg(actions.watch.favorite ? 'cardMenu.removeFavourite' : 'cardMenu.addFavourite')}
          run={() => void change({ favorite: !actions.watch.favorite })} /> : null}
        {actions?.watchlist ? <ActionButton testID="detail-watch-watchlist" disabled={busy}
          icon={actions.watch.watchlisted ? 'bookmark-fill' : 'bookmark'} active={actions.watch.watchlisted}
          label={msg(actions.watch.watchlisted ? 'cardMenu.removeWatchlist' : 'cardMenu.addWatchlist')}
          run={() => void change({ watchlisted: !actions.watch.watchlisted })} /> : null}
        {host.env.canPlaylists ? <ActionButton testID="detail-add-playlist" disabled={busy}
          icon="playlist-add" active={false} label={msg('cardMenu.addToPlaylist')}
          run={() => host.dispatch('addToPlaylist', `${id}|${title.kind}`)} /> : null}
        {downloadTitle ? <TitleDownload key={id} id={id} kind={title.kind} name={title.name} onError={setError} onNote={setNote} /> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={look.text({ 'font-size': '13px', color: '$ui.accent' })}>{error}</Text> : null}
      {note && !error ? <Text testID="detail-download-note" style={[look.text({ 'font-size': '13px', color: '$ui.inkSecondary' }), { maxWidth: '100%', flexShrink: 1 }]}>{note}</Text> : null}
    </View>
  );
}

const SAVE_FILE_NOTE = 'This browser may clear stored videos, so Vela saves the file to your downloads instead.';

function TitleDownload({ id, kind, name, onError, onNote }: { id: string; kind: string; name: string; onError(message: string): void; onNote(message: string): void }) {
  const vela = useVela();
  const host = useHost();
  const switcher = useServerSwitch();
  const look = useLook();
  const revision = useVelaState(state => state.auth.revision);
  const persisted = useVelaState(state => state.downloads.persisted);
  const item = useVelaState(state => state.downloads.items.find(item => item.titleId === id));
  const [offer, setOffer] = useState<DownloadOffer>({ kind: 'none', reason: 'unsupported' });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let current = true;
    void vela.downloads.offer(kind).then(value => {
      if (current) setOffer(value);
    }).catch(() => {});
    return () => { current = false; };
  }, [vela, revision, kind, persisted]);
  const reason = downloadOfferReason(offer);
  // Why this title saves a file or can't be downloaded here is information, not an error.
  const note = item ? '' : offer.kind === 'save-file' ? SAVE_FILE_NOTE : offer.kind === 'none' && offer.reason === 'browser' ? reason : '';
  useEffect(() => {
    onNote(note);
    return () => onNote('');
  }, [note, onNote]);
  if (offer.kind === 'none' && !item) return null;

  const versionId = async () => (await vela.catalogue.titleVersions(id).catch(() => null))?.selectedVersionId ?? undefined;
  const download = async () => {
    if (busy) return;
    setBusy(true);
    onError('');
    try {
      let started: unknown;
      if (item?.status === 'failed' || item?.status === 'paused') {
        started = await vela.downloads.resume(id);
      } else {
        const version = await versionId();
        if (vela.getState().auth.revision !== revision) return;
        started = await vela.downloads.enqueue(id, { versionId: version });
      }
      // A browser that won't keep its storage turns Download into Save file; the note says why.
      if (!started && vela.getState().downloads.persisted === false && vela.getState().downloads.traits.engine === 'page') {
        vela.downloads.clearError();
        return;
      }
      setFailed(!started);
      if (!started) onError(vela.getState().downloads.error || 'Could not start the download');
    } finally {
      setBusy(false);
    }
  };
  const saveFile = async () => {
    if (busy) return;
    setBusy(true);
    onError('');
    try {
      const version = await versionId();
      if (vela.getState().auth.revision !== revision) return;
      const done = await vela.downloads.saveFile(id, { versionId: version });
      setSaved(done);
      if (!done && vela.getState().downloads.error) onError(vela.getState().downloads.error);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!await confirmAction('Remove download?', name, 'Remove')) return;
    if (vela.getState().auth.revision !== revision) return;
    await vela.downloads.remove(id).catch(() => onError('Could not remove the download'));
  };
  const downloaded = isPlayableDownload(item);
  const status = item?.status;
  const transferring = status === 'queued' || status === 'downloading';
  const retry = status === 'failed' || failed;
  const percent = downloadPercent(item);
  const saving = !item && offer.kind === 'save-file';
  const label = saving ? (busy ? 'Saving file' : saved ? 'Saved' : 'Save file')
    : downloaded ? 'Downloaded' : busy ? 'Preparing download' : status === 'downloading' ? 'Downloading' :
    status === 'queued' ? 'Download queued' : retry ? 'Retry download' : status === 'paused' ? 'Resume download' : 'Download';
  const press = () => {
    if (saving) void saveFile();
    else if (downloaded) {
      // The page has no native action sheet: the Downloads library plays and deletes there.
      if (Platform.OS === 'web') {
        if (switcher?.openDownloads) switcher.openDownloads();
        else host.dispatch('play', id);
        return;
      }
      Alert.alert(name, undefined, [
        { text: 'Play offline', onPress: () => host.dispatch('play', id) },
        { text: 'Remove', style: 'destructive', onPress: () => void remove() },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else if (transferring) switcher?.openDownloads?.();
    else void download();
  };
  return <ActionButton label={label} icon={saving ? (saved ? 'checkmark' : 'download') : retry && !downloaded ? 'restart' : status === 'queued' && !downloaded ? 'clock' : 'download'}
    testID="detail-download" disabled={busy || (transferring && !downloaded && !switcher?.openDownloads)} round
    active={downloaded} run={press} value={status === 'downloading' && percent !== undefined ? `${percent}%` : undefined}>
    {downloaded ? <View pointerEvents="none" style={{
      position: 'absolute', right: -1, bottom: -1, width: 16, height: 16, borderRadius: 8,
      alignItems: 'center', justifyContent: 'center', backgroundColor: look.ui.ink,
    }}><Glyph symbol="checkmark" size={11} color={look.ui.inkInverse} /></View> : null}
    {status === 'downloading' && !downloaded ? (
      <Svg width={44} height={44} viewBox="0 0 44 44" style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false}>
        <Circle cx={22} cy={22} r={20} stroke={look.ui.glassEdgeStrong} strokeWidth={2} fill="none" />
        <Circle cx={22} cy={22} r={20} stroke={look.ui.accent} strokeWidth={2} fill="none"
          strokeDasharray={[2 * Math.PI * 20, 2 * Math.PI * 20]}
          strokeDashoffset={2 * Math.PI * 20 * (1 - (percent ?? 22) / 100)}
          strokeLinecap="round" transform="rotate(-90 22 22)" />
      </Svg>
    ) : null}
  </ActionButton>;
}

function ActionButton({ label, icon, active, testID, run, disabled, round, value, children }: {
  label: string;
  icon: string;
  active: boolean;
  testID: string;
  run(): void;
  disabled: boolean;
  round?: boolean;
  value?: string;
  children?: ReactNode;
}) {
  const look = useLook();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pressed, setPressed] = useState(false);
  const lit = hover || focus;
  const tooltip = useCallback((node: ComponentRef<typeof FocusPressable> | null) => {
    if (Platform.OS === 'web') (node as unknown as HTMLElement | null)?.setAttribute('title', label);
  }, [label]);
  return (
    <FocusPressable
      ref={tooltip}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected: active }}
      accessibilityValue={value ? { text: value } : undefined}
      testID={testID}
      disabled={disabled} onPress={run}
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
      style={[
        look.box({
          width: '44px', height: '44px', 'align-items': 'center', 'justify-content': 'center',
          'border-radius': round ? '22px' : '$ui.radiusControl', 'background-color': lit || active ? '$ui.controlHover' : '$ui.control',
          border: focus ? '1px solid $ui.accent' : '1px solid $ui.glassEdge',
          'backdrop-filter': 'blur(16px)',
        }),
        Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as ViewStyle) : null,
        pressed ? { opacity: 0.7, transform: [{ scale: 0.985 }] } : null,
        // Android draws no box shadows and a 1px tan edge reads like an active fill: a TV shows focus
        // as a ring in ink and a lift, as the media pages' round buttons do.
        Platform.isTV ? { borderWidth: 3, borderColor: focus ? look.ui.ink : 'transparent', transform: [{ scale: focus ? 1.1 : 1 }] } : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      {children}
      <Glyph symbol={icon} size={18} color={look.ui.ink} />
    </FocusPressable>
  );
}
