import { downloadPercent, formatDownloadBytes, isPlayableDownload, type DownloadRecord, type DownloadsState } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { HostContext, useHost } from '@vela/skin/src/host';
import { Alert as Notice, Glyph, Heading, Pill, Words } from '@vela/skin/src/widgets/common/controls';
import { useLook } from '@vela/skin/src/widgets/common/look';
import { RoundButton } from '@vela/skin/src/widgets/media/parts';
import { confirmAction } from '@vela/skin/src/widgets/common/confirm';
import { Image } from 'expo-image';
import { router } from '../src/router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DOWNLOAD_SETTINGS, useVela as useApp } from '../src/vela';
import { preferences } from '../src/data/preferences';

const transferStatus: Record<DownloadRecord['status'], string> = {
  queued: 'Queued', downloading: 'Downloading', paused: 'Paused',
  completed: 'Available offline', failed: 'Download failed',
};

export default function Downloads() {
  const { host } = useApp();
  const skin = host('home', '');
  return skin ? <HostContext.Provider value={skin}><DownloadLibrary /></HostContext.Provider> : null;
}

function DownloadLibrary() {
  const store = useVela();
  const { ui } = useLook();
  const width = useHost().viewport.width;
  const wide = width >= 640;
  // A desktop window gives the list more room, so a row's actions sit on one line beside its title.
  const roomy = width >= 1200;
  const { items, usedBytes, hydrated, error, traits, persisted, settings } = useVelaState(state => state.downloads);
  const toggleWifi = () => {
    store.downloads.setWifiOnly(!settings.wifiOnly);
    preferences.set(DOWNLOAD_SETTINGS, JSON.stringify(store.getState().downloads.settings));
  };
  useEffect(() => { void store.downloads.refreshStorage(); }, [store]);
  const online = useVelaState(state => state.auth.phase === 'signed-in');
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState('');
  const perform = async (id: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(id);
    setFailure('');
    store.downloads.clearError();
    try { await action(); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Could not update download'); }
    finally { setBusy(''); }
  };
  const remove = async (item: DownloadRecord) => {
    if (!await confirmAction('Delete download?', item.title.name, 'Delete')) return;
    const current = store.downloads.item(item.titleId);
    if (current?.viewerId === item.viewerId && current.serverId === item.serverId) {
      void perform(item.titleId, () => store.downloads.remove(item.titleId));
    }
  };
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(online ? '/' : '/sign-in');
  };
  return (
    <SafeAreaView style={[styles.page, { backgroundColor: ui.page }]}>
      <ScrollView contentContainerStyle={[styles.content, wide && styles.wideContent, roomy && styles.roomyContent]} testID="downloads-screen">
        <View style={styles.header}>
          <RoundButton icon="back" label="Back" onPress={back} testID="downloads-back" />
          <View style={styles.heading}>
            <Heading title="Downloads" />
            {hydrated ? <Words rows={{ 'font-size': '14px', color: '$ui.inkSecondary' }}>{formatDownloadBytes(usedBytes)} used on this device</Words> : null}
          </View>
        </View>
        {failure || error ? <Notice>{failure || error}</Notice> : null}
        {traits.metered ? <View style={styles.setting}>
          <Words rows={{ 'font-size': '14px', color: '$ui.inkSecondary' }} style={styles.settingText}>
            {settings.wifiOnly ? 'Downloads wait for Wi-Fi.' : 'Downloads also use mobile data.'}
          </Words>
          <Pill label={settings.wifiOnly ? 'Allow mobile data' : 'Wi-Fi only'} height={40} onPress={toggleWifi} testID="downloads-wifi-only" />
        </View> : null}
        {storageNotice(traits, persisted) ? <View testID="downloads-storage-notice">
          <Words rows={{ 'font-size': '14px', color: '$ui.inkSecondary' }}>{storageNotice(traits, persisted)}</Words>
        </View> : null}
        {items.map(item => <DownloadRow key={item.titleId} item={item} online={online} wide={wide} busy={!!busy}
          reveal={traits.reveal ? () => void perform(item.titleId, () => store.downloads.reveal(item.titleId)) : undefined}
          exportCopy={traits.export ? () => void perform(item.titleId, () => store.downloads.exportCopy(item.titleId)) : undefined}
          play={() => router.push({ pathname: '/watch/[id]', params: { id: item.titleId } })}
          pause={() => void perform(item.titleId, () => store.downloads.pause(item.titleId))}
          resume={() => void perform(item.titleId, () => store.downloads.resume(item.titleId))}
          remove={() => void remove(item)} />)}
        {!items.length ? <View style={[styles.empty, { borderColor: ui.glassEdge, backgroundColor: ui.control }]}>
          <Glyph symbol="download" size={28} color={ui.inkQuiet} />
          <Words rows={{ 'font-size': '18px', 'font-weight': '650' }}>{hydrated ? 'No downloaded titles' : 'Loading downloads…'}</Words>
          {hydrated ? <Words rows={{ 'font-size': '14px', color: '$ui.inkSecondary' }}>
            {Platform.isTV ? 'Open a movie or episode and select Download to watch it without an internet connection.'
              : 'Open a movie or episode and choose Download to watch it without an internet connection.'}
          </Words> : null}
        </View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Where a browser keeps downloads and when it may remove them; nothing for apps that own their storage. */
function storageNotice(traits: DownloadsState['traits'], persisted: boolean | null): string {
  if (traits.engine !== 'page') return '';
  return persisted === false
    ? 'This browser may clear stored videos, so Vela saves files to your downloads instead. Downloads already here can still be removed by the browser.'
    : 'Downloads are kept in this browser\'s storage for this site. Clearing site data or uninstalling the app removes them.';
}

function DownloadRow({ item, online, wide, busy, play, pause, resume, remove, reveal, exportCopy }: {
  item: DownloadRecord; online: boolean; wide: boolean; busy: boolean; play(): void; pause(): void; resume(): void; remove(): void;
  reveal?: () => void; exportCopy?: () => void;
}) {
  const store = useVela();
  const host = useHost();
  const look = useLook();
  const { ui } = look;
  const { title, titleId, status, bytesWritten, byteLength } = item;
  const [poster, setPoster] = useState<string>();
  const [badLocal, setBadLocal] = useState<string>();
  const [badRemote, setBadRemote] = useState<string>();
  const storedPosterPath = item.posterPath ?? item.previousCompleted?.posterPath;
  useEffect(() => {
    let current = true;
    setPoster(undefined);
    void store.downloads.posterFor(titleId).then(url => { if (current) setPoster(url); }).catch(() => {});
    return () => { current = false; };
  }, [store, titleId, item.serverId, item.viewerId, status, storedPosterPath]);
  const remotePoster = online ? item.posterUrl : undefined;
  const localArt = poster && poster !== badLocal ? poster : undefined;
  const art = localArt ? { uri: localArt } : remotePoster && remotePoster !== badRemote ? host.image(remotePoster) : undefined;
  const percent = downloadPercent(item);
  const transferring = status === 'queued' || status === 'downloading';
  const playable = isPlayableDownload(item);
  const episode = title.kind === 'episode'
    ? [
      title.showName,
      title.seasonNumber == null ? undefined : `S${title.seasonNumber}`,
      title.episodeNumber == null ? undefined : `E${title.episodeNumber}`,
    ].filter(Boolean).join(' · ')
    : '';
  const size = status !== 'completed' && byteLength ? `${formatDownloadBytes(bytesWritten)} of ${formatDownloadBytes(byteLength)}` : formatDownloadBytes(bytesWritten);
  return (
    <View style={[styles.row, { borderColor: ui.glassEdge, backgroundColor: ui.control }]} testID={`download-${titleId}`}>
      <View style={[styles.art, { backgroundColor: ui.page }]}>
        {art ? <Image source={art} accessible={false} style={StyleSheet.absoluteFill} contentFit="cover"
          onError={() => localArt ? setBadLocal(localArt) : setBadRemote(remotePoster)} /> :
          <Glyph symbol="tv" size={24} color={ui.inkQuiet} />}
      </View>
      <View style={[styles.details, wide && styles.wideDetails]}>
        <View style={[styles.metadata, wide && styles.wideMetadata]}>
          {episode ? <Words rows={{ 'font-size': '12px', color: '$ui.inkSecondary' }}>{episode}</Words> : null}
          <Words accessibilityRole="header" rows={{ 'font-size': '18px', 'font-weight': '650' }}>{title.name}</Words>
          <Words rows={{ 'font-size': '13px', color: '$ui.inkSecondary' }}>
            {`${transferStatus[status]} · ${size}${status === 'downloading' && percent !== undefined ? ` · ${percent}%` : ''}`}
          </Words>
          {status === 'downloading' ? <View accessibilityRole="progressbar"
            accessibilityValue={percent === undefined ? undefined : { min: 0, max: 100, now: percent }}
            style={[styles.track, { backgroundColor: ui.page }]}>
            <View style={{ width: `${percent ?? 22}%`, height: '100%', backgroundColor: ui.accent }} />
          </View> : null}
          {item.error ? <Notice>{item.error}</Notice> : null}
        </View>
        <View style={[styles.actions, wide && styles.wideActions]}>
          {playable ? <Pill label="Play" primary height={40} onPress={play} disabled={busy} /> : null}
          {transferring ? <Pill label="Pause" height={40} onPress={pause} disabled={busy} /> : null}
          {online && (status === 'paused' || status === 'failed') ? (
            <Pill label={status === 'paused' ? 'Resume' : 'Retry'} height={40} onPress={resume} disabled={busy} />
          ) : null}
          {playable && reveal ? <Pill label={Platform.OS === 'web' && desktopMac() ? 'Show in Finder' : 'Show in folder'} height={40} onPress={reveal} disabled={busy} testID={`download-reveal-${titleId}`} /> : null}
          {playable && exportCopy ? <Pill label="Save a copy…" height={40} onPress={exportCopy} disabled={busy} testID={`download-export-${titleId}`} /> : null}
          <Pill label="Delete" height={40} onPress={remove} disabled={busy} testID={`download-delete-${titleId}`} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { width: '100%', maxWidth: 800, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32, gap: 14 },
  wideContent: { paddingHorizontal: 40 },
  roomyContent: { maxWidth: 1120 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  heading: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 14, borderRadius: 16, borderWidth: 1 },
  art: { width: 70, height: 105, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  details: { flex: 1, minWidth: 0, gap: 5 },
  wideDetails: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 16 },
  metadata: { minWidth: 0, gap: 5 },
  wideMetadata: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 5 },
  wideActions: { marginTop: 0, justifyContent: 'flex-end', flexShrink: 0, maxWidth: '62%' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginVertical: 2 },
  setting: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  settingText: { flex: 1, minWidth: 180 },
  empty: { borderWidth: 1, borderRadius: 16, padding: 20, gap: 8, alignItems: 'flex-start' },
});

/** The Mac desktop app calls its file manager Finder. */
function desktopMac(): boolean {
  return (globalThis as { __VELA_DESKTOP__?: { platform?: string } }).__VELA_DESKTOP__?.platform === 'mac';
}
